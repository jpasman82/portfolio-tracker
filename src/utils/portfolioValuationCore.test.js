import { describe, expect, it } from 'vitest';
import { buildPortfolioValuation } from './portfolioValuationCore.js';
import { parseNum } from './numberFormat.js';
import { isUsdBroker } from './brokers.js';

const position = (id, assets, usdRate = 1000, debt = 0) => ({ id, data: { assets, usdRate, debt } });
const asset = (ticker, quantity, price, extra = {}) => ({ ticker, quantity, price, ...extra });
const brokerNet = positions => positions.reduce((sum, broker) => {
  const rate = isUsdBroker(broker.id) ? 1 : parseNum(broker.data.usdRate) || 1;
  const total = broker.data.assets.reduce((amount, item) => amount + parseNum(item.quantity) * parseNum(item.price) / (item.isBond || /^[A-Z]{2,3}\d{2}[A-Z]?$/i.test(item.ticker) ? 100 : 1) / rate, 0);
  return sum + total - parseNum(broker.data.debt);
}, 0);

describe('shared broker and unified portfolio valuation', () => {
  it.each(['XP','NU','PAX','VALE','ITUB','EWZ'])('includes held Brazilian CEDEAR %s', ticker => {
    const valuation = buildPortfolioValuation([position('balanz',[asset(ticker,10,5000)])]);
    expect(valuation.totals.netUsd).toBe(50);
    expect(valuation.grouped.CEDEARs.subs.Brasil.assets[0].ticker).toBe(ticker);
  });
  it('matches the sum of brokers, aggregates duplicate tickers and subtracts debt once', () => {
    const input = [position('balanz',[asset('NU',10,5000),asset('AL30',1000,80000)],1000,25),position('one',[asset('NU',10,6000)],1200,20),position('jpm',[asset('TFU27',100,101),asset('BIOX',500,0.48)],9999)];
    const valuation = buildPortfolioValuation(input,{mepRate:2000});
    expect(valuation.totals.netUsd).toBeCloseTo(brokerNet(input),10);
    expect(valuation.assets.find(item=>item.ticker==='NU')).toMatchObject({quantity:20,valueUsd:100});
    expect(valuation.totals.debtUsd).toBe(45);
    const groupedTotal=Object.values(valuation.grouped).reduce((sum,group)=>sum+group.total,0);
    expect(groupedTotal).toBeCloseTo(valuation.totals.netUsd,10);
    expect(valuation.brokers.reduce((sum,broker)=>sum+broker.netUsd,0)).toBeCloseTo(valuation.totals.netUsd,10);
  });
  it('uses saved broker FX with saved quotes despite a newer cached MEP', () => {
    expect(buildPortfolioValuation([position('balanz',[asset('GGAL',10,5000)],1000)],{mepRate:2000}).totals.netUsd).toBe(50);
  });
  it('values USD brokers directly and keeps sub-dollar decimals', () => {
    expect(buildPortfolioValuation([position('jpm',[asset('BIOX','1.000','0.48')])]).totals.netUsd).toBe(480);
  });
  it('divides bond prices by 100 once in both total and displayed quote', () => {
    const valuation=buildPortfolioValuation([position('balanz',[asset('AL30',1000,80000)],1000)]);
    expect(valuation.totals.netUsd).toBe(800);
    expect(valuation.assets[0]).toMatchObject({unitPriceUsd:0.8,quotedPriceUsd:80});
  });
  it('keeps quantities, debt and source fields immutable', () => {
    const input=[position('balanz',[asset('VALE',10,5000),asset(' ewz ',1,2000)],1000,100)];
    const before=structuredClone(input);
    buildPortfolioValuation(input);
    expect(input).toEqual(before);
  });
  it('includes manual unknown and missing-ticker rows instead of silently losing their balance', () => {
    const valuation=buildPortfolioValuation([position('balanz',[asset('CUSTOM',2,5000),asset('',3,1000)])]);
    expect(valuation.totals.netUsd).toBe(13);
    expect(valuation.grouped.Otros.total).toBe(13);
  });
  it('uses saved MEP for ARS totals when there is no quote cache', () => {
    const valuation=buildPortfolioValuation([position('jpm',[asset('BIOX',100,0.5)]),position('balanz',[asset('GGAL',1,5000)],1000)]);
    expect(valuation.rates.mep).toBe(1000);
    expect(valuation.assets.reduce((sum,row)=>sum+row.valueArs,0)).toBe(valuation.totals.assetsArs);
  });
});
