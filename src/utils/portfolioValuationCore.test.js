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
  it('keeps the broker breakdown for each consolidated ticker', () => {
    const valuation = buildPortfolioValuation([
      position('balanz', [asset('GGAL', 10, 5000)], 1000),
      position('one', [asset('GGAL', 4, 6000)], 1200),
    ]);

    expect(valuation.assets.find(item => item.ticker === 'GGAL').brokerPositions).toEqual([
      { brokerId: 'balanz', quantity: 10, valueUsd: 50 },
      { brokerId: 'one', quantity: 4, valueUsd: 20 },
    ]);
  });
  it('keeps held species visible when a saved quote is temporarily zero', () => {
    const valuation = buildPortfolioValuation([
      position('balanz', [asset('AAPL', 10, 0)]),
    ]);

    expect(valuation.assets.find(item => item.ticker === 'AAPL')).toMatchObject({
      ticker: 'AAPL',
      quantity: 10,
      valueUsd: 0,
    });
    expect(valuation.grouped.CEDEARs.subs.Tecnología.assets[0].ticker).toBe('AAPL');
    expect(valuation.marketPrices.some(item => item.ticker === 'AAPL')).toBe(false);
  });
  it('keeps the broker breakdown for consolidated debt', () => {
    const valuation = buildPortfolioValuation([
      position('balanz', [], 1000, 25),
      position('one', [], 1200, 20),
    ]);

    expect(valuation.grouped.Pasivos.subs.Deuda.assets[0].brokerPositions).toEqual([
      { brokerId: 'balanz', valueUsd: -25 },
      { brokerId: 'one', valueUsd: -20 },
    ]);
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
  it('exposes missing live quotes without dropping their saved valuation', () => {
    const input=[{id:'balanz',data:{assets:[asset('CO26',100,5089)],usdRate:1000,debt:0,missingPrices:['CO26'],priceRefreshStatus:'PARTIAL'}}];
    const valuation=buildPortfolioValuation(input);
    expect(valuation.totals.netUsd).toBeCloseTo(5.089,8);
    expect(valuation.missingPrices).toEqual(['CO26']);
    expect(valuation.brokers[0]).toMatchObject({missingPrices:['CO26'],priceRefreshStatus:'PARTIAL'});
  });
  it('overrides the stale BPA11 bond flag and values it per CEDEAR unit', () => {
    const valuation=buildPortfolioValuation([position('balanz',[asset('BPA11',10,18460,{isBond:true})],1000)]);
    expect(valuation.totals.netUsd).toBeCloseTo(184.6,8);
    expect(valuation.assets[0]).toMatchObject({ticker:'BPA11',isBond:false});
  });
});
