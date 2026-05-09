function mean(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0}
function stddev(arr){if(arr.length<2)return 0;const m=mean(arr);return Math.sqrt(arr.reduce((s,x)=>s+(x-m)**2,0)/(arr.length-1))}
function clamp(v,min,max){return Math.max(min,Math.min(max,Number(v)||0))}
function pct(a,b){return b?(a/b-1)*100:0}
function sma(values,period,end=values.length){if(end<period)return null;return mean(values.slice(end-period,end))}
function calcRSI(closes,period=14,end=closes.length){if(end<=period)return 50;let gains=0,losses=0;const s=closes.slice(end-period-1,end);for(let i=1;i<s.length;i++){const d=s[i]-s[i-1];if(d>=0)gains+=d;else losses+=Math.abs(d)}if(losses===0)return 100;const rs=gains/losses;return 100-100/(1+rs)}
function maxDrawdown(closes){let peak=closes[0]||0,mdd=0;for(const c of closes){if(c>peak)peak=c;if(peak>0){const dd=(c/peak-1)*100;if(dd<mdd)mdd=dd}}return mdd}
function annualizedVolatility(closes){if(closes.length<3)return 0;const r=[];for(let i=1;i<closes.length;i++)r.push(closes[i]/closes[i-1]-1);return stddev(r)*Math.sqrt(252)*100}
function scoreReturn(ret){return clamp(50+ret*1.05,0,100)}
function scoreDrawdown(mdd){return clamp(100+mdd*2.4,0,100)}
function scoreVol(vol){return clamp(100-vol*1.8,0,100)}
function scoreRSI(rsi){if(rsi>=45&&rsi<=65)return 86;if(rsi>65&&rsi<=72)return 68;if(rsi>72)return 35;if(rsi>=35&&rsi<45)return 58;return 32}
function slopeScore(closes,period,end=closes.length){if(end<period+1)return 50;const start=closes[end-period-1],last=closes[end-1];return clamp(50+pct(last,start)*1.15,0,100)}
function calcSnapshot(closes,end=closes.length){
  const current=closes[end-1];
  const ma20=sma(closes,20,end),ma60=sma(closes,60,end),ma120=sma(closes,120,end),ma250=sma(closes,250,end);
  const rsi14=calcRSI(closes,14,end);
  const trendParts=[]; if(ma20)trendParts.push(current>ma20?1:-1); if(ma60)trendParts.push(current>ma60?1:-1); if(ma120)trendParts.push(current>ma120?1:-1); if(ma250)trendParts.push(current>ma250?1:-1);
  const trendScore=clamp(50+mean(trendParts)*35,0,100);
  const momentumScore=Math.round(slopeScore(closes,63,end)*0.36+slopeScore(closes,126,end)*0.30+slopeScore(closes,252,end)*0.24+scoreRSI(rsi14)*0.10);
  const recent=closes.slice(Math.max(0,end-126),end);
  const riskScore=Math.round(scoreDrawdown(maxDrawdown(recent))*0.48+scoreVol(annualizedVolatility(recent))*0.34+scoreRSI(rsi14)*0.18);
  const decisionScore=Math.round(trendScore*0.32+momentumScore*0.30+riskScore*0.28+scoreRSI(rsi14)*0.10);
  const strictSignal=decisionScore>=84&&trendScore>=75&&momentumScore>=72&&riskScore>=68&&rsi14>=42&&rsi14<=72&&current>ma20&&current>ma60&&(!ma120||current>ma120);
  return {current,ma20,ma60,ma120,ma250,rsi14,trendScore:Math.round(trendScore),momentumScore,riskScore,decisionScore,strictSignal};
}
function backtest(closes,forwardDays=20,targetWinRate=0.90){
  const start=260,signals=[];
  for(let end=start;end<closes.length-forwardDays;end++){
    const snap=calcSnapshot(closes,end);
    if(snap.strictSignal){
      const futureRet=pct(closes[end+forwardDays-1],closes[end-1]);
      signals.push({end,score:snap.decisionScore,futureRet,win:futureRet>2});
    }
  }
  const total=signals.length;
  const wins=signals.filter(x=>x.win).length;
  const winRate=total?wins/total:0;
  const avgRet=total?mean(signals.map(x=>x.futureRet)):0;
  const pass=total>=5&&winRate>=targetWinRate;
  return {total,wins,winRate,avgRet,pass,targetWinRate,forwardDays};
}
function analyzeAsset(asset,options={}){
  const targetWinRate=Number(options.targetWinRate||0.90);
  const forwardDays=Number(options.forwardDays||20);
  const prices=(asset.prices||[]).filter(p=>Number(p.close)>0).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const closes=prices.map(p=>Number(p.close));
  if(closes.length<280)throw new Error("历史数据不足。高置信模型至少需要约280个交易日。");
  const current=closes[closes.length-1],latest=prices[prices.length-1];
  const periods=[["3M","3个月",63],["6M","6个月",126],["9M","9个月",189],["1Y","1年",252],["3Y","3年",756]];
  const periodResults=periods.map(([key,label,days])=>{
    const n=Math.min(days,closes.length-1);
    const slice=closes.slice(-n);
    const ret=pct(current,closes[closes.length-1-n]);
    const mdd=maxDrawdown(slice),vol=annualizedVolatility(slice);
    return {key,label,returnPct:ret,maxDrawdownPct:mdd,volatilityPct:vol,score:Math.round(scoreReturn(ret)*0.42+scoreDrawdown(mdd)*0.30+scoreVol(vol)*0.28)};
  });
  const snap=calcSnapshot(closes);
  const bt=backtest(closes,forwardDays,targetWinRate);
  let action="观察";
  let level="中性";
  let position="0% - 15%";
  let confidence="不足";
  if(bt.pass&&snap.strictSignal){
    action="高置信：可小仓分批关注";
    level="高置信";
    position="15% - 30%";
    confidence="达标";
  }else if(snap.decisionScore>=74&&snap.riskScore>=58){
    action="等待回踩确认";
    level="可跟踪";
    position="5% - 20%";
    confidence="未达90%门槛";
  }else{
    action="回避或仅观察";
    level="偏弱";
    position="0% - 10%";
    confidence="不达标";
  }
  const warnings=[];
  if(!bt.pass)warnings.push(`历史滚动回测胜率 ${(bt.winRate*100).toFixed(1)}%，未达到目标 ${(targetWinRate*100).toFixed(0)}%。`);
  if(bt.total<5)warnings.push("历史高置信信号次数不足，统计意义偏弱。");
  if(snap.rsi14>72)warnings.push("RSI过热，短线追高风险较高。");
  if(snap.current<snap.ma60)warnings.push("价格低于60日均线，中期趋势仍需修复。");
  if(maxDrawdown(closes.slice(-126))<-18)warnings.push("近6个月最大回撤较深，波动风险较高。");
  if(annualizedVolatility(closes.slice(-126))>35)warnings.push("年化波动率偏高，不适合重仓。");
  if(!warnings.length)warnings.push("模型未发现极端风险，但仍需控制仓位。");
  const entryRules=[];
  if(bt.pass&&snap.strictSignal)entryRules.push("仅考虑分批，不一次性重仓。优先等待日内回踩或缩量确认。");
  else entryRules.push("当前不满足高置信条件，优先等待趋势、风险和历史胜率同时改善。");
  if(snap.current>snap.ma20&&snap.current>snap.ma60)entryRules.push("趋势条件尚可，重点观察20日线和60日线支撑。");
  if(snap.rsi14>70)entryRules.push("短线热度偏高，等待分歧后再评估。");
  return {
    symbol:asset.symbol,name:asset.name||asset.symbol,assetType:asset.assetType||"asset",
    latestDate:latest.date,latestClose:current,
    ma:{ma20:snap.ma20,ma60:snap.ma60,ma120:snap.ma120,ma250:snap.ma250},
    rsi14:snap.rsi14,
    scores:{decisionScore:snap.decisionScore,trendScore:snap.trendScore,momentumScore:snap.momentumScore,riskScore:snap.riskScore,multiPeriodScore:Math.round(mean(periodResults.map(x=>x.score)))},
    backtest:bt,action,level,position,confidence,periodResults,warnings,entryRules
  };
}
if(typeof window!=="undefined")window.FPDecisionModel={analyzeAsset};
