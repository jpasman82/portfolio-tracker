import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDocs:vi.fn(), runTransaction:vi.fn(), fetchPrices:vi.fn(), livePrice:vi.fn(), data:[], updates:[], mep:2000 }));
vi.mock('firebase/firestore',()=>({collection:vi.fn(()=> 'brokerPositions'),getDocs:mocks.getDocs,runTransaction:mocks.runTransaction}));
vi.mock('../firebase/config',()=>({db:{}}));
vi.mock('./priceService',()=>({fetchAllPrices:mocks.fetchPrices,getBrokerLivePrice:mocks.livePrice,getCclRate:()=>2100,getMepRate:()=>mocks.mep,getPriceMeta:()=>({}),isBondTicker:()=>false}));
import { fetchPortfolioValuation, refreshBrokerPrices } from './portfolioValuation.js';
const document = row => ({id:row.id,ref:{id:row.id},data:()=>row.data,exists:()=>true});
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.data=[{id:'balanz',data:{usdRate:1000,debt:4,assets:[{ticker:'NU',quantity:10,price:5000,note:'manual'}],lastUpdated:'old'}},{id:'jpm',data:{usdRate:1,debt:3,assets:[{ticker:'BIOX',quantity:20,price:0.48}]}}];
 mocks.mep=2000;
 mocks.updates=[];
 mocks.getDocs.mockImplementation(async()=>({docs:mocks.data.map(document)}));
 mocks.fetchPrices.mockResolvedValue({NU:6000});
 mocks.livePrice.mockImplementation(ticker=>ticker==='NU'?6000:undefined);
 mocks.runTransaction.mockImplementation(async(db,callback)=>callback({get:async ref=>document(mocks.data.find(row=>row.id===ref.id)),update:(ref,payload)=>{mocks.updates.push({id:ref.id,payload});Object.assign(mocks.data.find(row=>row.id===ref.id).data,payload);}}));
});
describe('common portfolio data flow',()=>{
 it('read-only valuation does not reprice or use cached FX over saved FX',async()=>{
  const valuation=await fetchPortfolioValuation({refreshPrices:false});
  expect(valuation.totals.netUsd).toBeCloseTo(52.6,8);
  expect(mocks.fetchPrices).not.toHaveBeenCalled();
  expect(mocks.runTransaction).not.toHaveBeenCalled();
 });
 it('refresh saves prices and FX together before reading the consolidated value',async()=>{
  const valuation=await fetchPortfolioValuation({refreshPrices:true});
  expect(valuation.totals.netUsd).toBeCloseTo(32.6,8);
  expect(mocks.updates.find(row=>row.id==='balanz').payload).toMatchObject({usdRate:2000,assets:[{ticker:'NU',quantity:10,price:6000,note:'manual'}]});
  expect(mocks.updates.every(row=>!('debt' in row.payload))).toBe(true);
  expect(mocks.data.find(row=>row.id==='jpm').data.assets[0]).toMatchObject({price:0.48,quantity:20});
 });
 it('deduplicates overlapping refreshes into one quote request and one transaction',async()=>{
  await Promise.all([refreshBrokerPrices(),refreshBrokerPrices()]);
  expect(mocks.fetchPrices).toHaveBeenCalledTimes(1);
  expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
 });
 it('navigation within the same minute retains the published broker quotes',async()=>{
  await refreshBrokerPrices();
  const first=await fetchPortfolioValuation({refreshPrices:false});
  const second=await fetchPortfolioValuation({refreshPrices:true});
  expect(second.totals.netUsd).toBe(first.totals.netUsd);
  expect(mocks.fetchPrices).toHaveBeenCalledTimes(1);
  expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
 });
 it('manual refresh can explicitly replace quotes within the same minute',async()=>{
  await refreshBrokerPrices();
  await refreshBrokerPrices({force:true});
  expect(mocks.fetchPrices).toHaveBeenCalledTimes(2);
  expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
 });
 it('reads quantities again inside the transaction so concurrent manual edits survive',async()=>{
  mocks.runTransaction.mockImplementation(async(db,callback)=>{
   mocks.data[0].data.assets[0].quantity=15;
   await callback({get:async ref=>document(mocks.data.find(row=>row.id===ref.id)),update:(ref,payload)=>mocks.updates.push({id:ref.id,payload})});
  });
  await refreshBrokerPrices();
  expect(mocks.updates[0].payload.assets[0].quantity).toBe(15);
 });
 it('keeps saved valuation if no market data is available',async()=>{
  mocks.mep=null;
  mocks.fetchPrices.mockResolvedValue({});
  const valuation=await fetchPortfolioValuation({refreshPrices:true});
  expect(valuation.totals.netUsd).toBeCloseTo(52.6,8);
  expect(mocks.runTransaction).not.toHaveBeenCalled();
 });
 it('clears a failed refresh so the next refresh can retry',async()=>{
  mocks.fetchPrices.mockRejectedValueOnce(new Error('network'));
  await expect(refreshBrokerPrices()).rejects.toThrow('network');
  await expect(refreshBrokerPrices()).resolves.toBe(true);
  expect(mocks.fetchPrices).toHaveBeenCalledTimes(2);
 });
});
