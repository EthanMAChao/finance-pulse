(function(){
  function mean(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0}
  function stddev(arr){if(arr.length<2)return 0;const m=mean(arr);return Math.sqrt(arr.reduce((s,x)=>s+(x-m)**2,0)/(arr.length-1))}
  function clamp(v,min,max){return Math.max(min,Math.min(max,Number(v)||0))}
  function pct(a,b){return b?(a/b-1)*100:0}
  function sma(values,period,end=values.length){if(end<period)return null;return mean(values.slice(end-period,end))}
  function calcRSI(closes,period=14,end=closes.length){if(end<=period)return 50;let gains=0,losses=0;const s=closes.slice(end-period-1,end);for(let i=1;i<s.length;i++){const d=s[i]-s[i-1];if(d>=0)gains+=d;else losses+=Math.abs(d)}if(losses===0)return 100;const rs=gains/losses;return 100-100/(1+rs)}
  function maxDrawdown(closes){let peak=closes[0]||0,mdd=0;for(const c of closes){if(c>peak)peak=c;if(peak>0){const dd=(c/peak-1)*100;if(dd<mdd)mdd=dd}}return mdd}
  function annualizedVolatility(closes){if(closes.length<3)return 0;const rets=[];for(let i=1;i<closes.length;i++)rets.push(closes[i]/closes[i-1]-1);return stddev(rets)*Math.sqrt(252)*100}
  function scoreReturn(ret){return clamp(50+ret*1.0,0,100)}
  function scoreDrawdown(mdd){return clamp(100+mdd*2.35,0,100)}
  function scoreVol(vol){return clamp(100-vol*1.75,0,100)}
  function scoreRSI(rsi){if(rsi>=45&&rsi<=64)return 88;if(rsi>64&&rsi<=72)return 68;if(rsi>72)return 34;if(rsi>=35&&rsi<45)return 58;return 32}
  function slopeScore(closes,period,end=closes.length){if(end<period+1)return 50;return clamp(50+pct(closes[end-1],closes[end-period-1])*1.1,0,100)}
  function avgVolume(prices,period,end=prices.length){if(end<period)return null;return mean(prices.slice(end-period,end).map(x=>Number(x.volume)||0))}
  function wilsonLowerBound(wins,total,z=1.28){if(total===0)return 0;const phat=wins/total;const denom=1+z*z/total;const centre=phat+z*z/(2*total);const margin=z*Math.sqrt((phat*(1-phat)+z*z/(4*total))/total);return Math.max(0,(centre-margin)/denom)}
  function maxConsecutiveLosses(trades){let maxL=0,cur=0;for(const t of trades){if(!t.win){cur++;maxL=Math.max(maxL,cur)}else cur=0}return maxL}
  function profitFactor(trades){const gains=trades.filter(t=>t.netReturn>0).reduce((s,t)=>s+t.netReturn,0);const losses=Math.abs(trades.filter(t=>t.netReturn<0).reduce((s,t)=>s+t.netReturn,0));if(losses===0)return gains>0?99:0;return gains/losses}
  function calcSnapshot(asset,end){
    const prices=asset.prices;const closes=prices.map(p=>Number(p.close));const current=closes[end-1];
    const ma20=sma(closes,20,end),ma60=sma(closes,60,end),ma120=sma(closes,120,end),ma250=sma(closes,250,end);
    const rsi14=calcRSI(closes,14,end);
    const vol20=avgVolume(prices,20,end),vol60=avgVolume(prices,60,end);
    const volumeConfirm=vol20&&vol60?vol20>=vol60*0.92:true;
    const trendParts=[];[ma20,ma60,ma120,ma250].forEach(ma=>{if(ma)trendParts.push(current>ma?1:-1)});
    const trendScore=clamp(50+mean(trendParts)*35,0,100);
    const momentumScore=Math.round(slopeScore(closes,63,end)*0.35+slopeScore(closes,126,end)*0.30+slopeScore(closes,252,end)*0.25+scoreRSI(rsi14)*0.10);
    const recent=closes.slice(Math.max(0,end-126),end);
    const riskScore=Math.round(scoreDrawdown(maxDrawdown(recent))*0.46+scoreVol(annualizedVolatility(recent))*0.34+scoreRSI(rsi14)*0.20);
    const volumeScore=volumeConfirm?76:48;
    const decisionScore=Math.round(trendScore*0.30+momentumScore*0.30+riskScore*0.27+scoreRSI(rsi14)*0.08+volumeScore*0.05);
    const strictSignal=decisionScore>=84&&trendScore>=75&&momentumScore>=72&&riskScore>=68&&rsi14>=42&&rsi14<=72&&current>ma20&&current>ma60&&(!ma120||current>ma120)&&volumeConfirm;
    return {current,ma20,ma60,ma120,ma250,rsi14,volumeConfirm,trendScore:Math.round(trendScore),momentumScore,riskScore,decisionScore,strictSignal};
  }
  function backtest(asset,opts){
    const prices=asset.prices;const closes=prices.map(p=>Number(p.close));const forwardDays=Number(opts.forwardDays||20);const costBps=Number(opts.costBps||15);const minSignals=Number(opts.minSignals||8);const targetWinRate=Number(opts.targetWinRate||0.90);const stopLossPct=Number(opts.stopLossPct||10);const regimeFilter=String(opts.regimeFilter||"strict");
    const trades=[];const start=280;
    for(let end=start;end<closes.length-forwardDays;end++){
      const snap=calcSnapshot(asset,end);
      const regimePass = regimeFilter==="loose" ? snap.decisionScore>=78 : regimeFilter==="normal" ? (snap.strictSignal || (snap.decisionScore>=82&&snap.trendScore>=72&&snap.riskScore>=64)) : snap.strictSignal;
      if(regimePass){
        const entry=closes[end-1];
        const futurePath=closes.slice(end,end+forwardDays);
        const gross=applyStopLoss(entry,futurePath,stopLossPct);
        const net=gross-costBps*2/100;
        trades.push({end,score:snap.decisionScore,grossReturn:gross,netReturn:net,win:net>2});
      }
    }
    const total=trades.length;const wins=trades.filter(t=>t.win).length;const winRate=total?wins/total:0;const lower=wilsonLowerBound(wins,total);
    const avgNet=total?mean(trades.map(t=>t.netReturn)):0;const pf=profitFactor(trades);const maxLoss=maxConsecutiveLosses(trades);
    const pass=total>=minSignals&&winRate>=targetWinRate&&lower>=Math.max(0,targetWinRate-0.12)&&pf>=1.6&&avgNet>1.0&&maxLoss<=3;
    return {total,wins,winRate,wilsonLowerBound:lower,avgNetReturn:avgNet,profitFactor:pf,maxConsecutiveLosses:maxLoss,pass,targetWinRate,forwardDays,costBps,minSignals,stopLossPct,regimeFilter};
  }

  function dataQuality(asset){
    const prices=(asset.prices||[]).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    const issues=[];
    if(prices.length<300)issues.push("历史交易日不足300个。");
    let bad=0,gaps=0,zeroVol=0;
    for(let i=0;i<prices.length;i++){
      const p=prices[i];
      if(!(Number(p.close)>0)||!(Number(p.high)>=Number(p.low)))bad++;
      if(Number(p.volume)===0)zeroVol++;
      if(i>0){
        const d1=new Date(prices[i-1].date),d2=new Date(p.date);
        const gap=(d2-d1)/(24*3600*1000);
        if(gap>10)gaps++;
      }
    }
    if(bad>0)issues.push(`发现 ${bad} 条异常价格。`);
    if(gaps>3)issues.push(`发现 ${gaps} 处较长日期缺口。`);
    if(zeroVol>prices.length*0.15)issues.push("成交量为0的记录偏多，可能影响量能判断。");
    return {ok:issues.length===0,issues,days:prices.length};
  }
  function applyStopLoss(entry,futurePath,stopLossPct){
    const stop=Number(stopLossPct||10);
    let minRet=0;
    for(const price of futurePath){
      const r=pct(price,entry);
      if(r<minRet)minRet=r;
      if(r<=-stop)return -stop;
    }
    return pct(futurePath[futurePath.length-1],entry);
  }

  function analyzeAsset(asset,options={}){
    if(!asset||!Array.isArray(asset.prices))throw new Error("资产数据格式错误，缺少 prices。");
    const clean=asset.prices.filter(p=>Number(p.close)>0).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const quality=dataQuality({...asset,prices:clean});
    if(clean.length<300)throw new Error("历史数据不足。V4 至少需要约300个交易日。");
    const normalized={...asset,prices:clean};const closes=clean.map(p=>Number(p.close));const current=closes[closes.length-1];const latest=clean[clean.length-1];
    const periods=[["3M","3个月",63],["6M","6个月",126],["9M","9个月",189],["1Y","1年",252],["3Y","3年",756]];
    const periodResults=periods.map(([key,label,days])=>{const n=Math.min(days,closes.length-1);const slice=closes.slice(-n);const ret=pct(current,closes[closes.length-1-n]);const mdd=maxDrawdown(slice);const vol=annualizedVolatility(slice);return {key,label,returnPct:ret,maxDrawdownPct:mdd,volatilityPct:vol,score:Math.round(scoreReturn(ret)*0.40+scoreDrawdown(mdd)*0.32+scoreVol(vol)*0.28)}});
    const snap=calcSnapshot(normalized,clean.length);const bt=backtest(normalized,options);const blockers=[];
    if(!bt.pass)blockers.push(`历史高置信回测未通过：胜率 ${(bt.winRate*100).toFixed(1)}%，Wilson下界 ${(bt.wilsonLowerBound*100).toFixed(1)}%。`);
    if(bt.total<bt.minSignals)blockers.push(`信号次数 ${bt.total} 次，少于最低门槛 ${bt.minSignals} 次。`);
    if(bt.profitFactor<1.6)blockers.push(`Profit Factor ${bt.profitFactor.toFixed(2)}，低于1.60。`);
    if(bt.maxConsecutiveLosses>3)blockers.push(`最大连续亏损 ${bt.maxConsecutiveLosses} 次，超过风控门槛。`);
    if(!snap.strictSignal)blockers.push("当前未触发严格趋势/动量/风险共振信号。");
    if(snap.rsi14>72)blockers.push("RSI偏热，追高风险上升。");
    let action="回避或仅观察",level="偏弱",position="0% - 10%",confidence="不达标";
    if(bt.pass&&snap.strictSignal){action="高置信：可小仓分批关注";level="高置信";position="15% - 30%";confidence="达标"}
    else if(snap.decisionScore>=76&&snap.riskScore>=60){action="等待回踩确认";level="可跟踪";position="5% - 20%";confidence="未达高置信门槛"}
    const warnings=[];
    if(blockers.length)warnings.push(...blockers);
    if(maxDrawdown(closes.slice(-126))<-18)warnings.push("近6个月最大回撤较深，波动风险偏高。");
    if(annualizedVolatility(closes.slice(-126))>35)warnings.push("年化波动率偏高，不适合重仓。");
    if(!warnings.length)warnings.push("模型未发现极端阻断项，但仍需控制仓位。");
    const entryRules=[];
    if(bt.pass&&snap.strictSignal)entryRules.push("只考虑小仓分批，不一次性重仓。优先等待日内回踩或缩量确认。");
    else entryRules.push("当前不满足高置信条件，优先等待胜率、趋势、动量、风险四项同时改善。");
    if(snap.current>snap.ma20&&snap.current>snap.ma60)entryRules.push("价格站上20日与60日均线，趋势结构尚可。");
    if(snap.rsi14>70)entryRules.push("短线热度偏高，等待分歧后再评估。");
    return {symbol:asset.symbol,name:asset.name||asset.symbol,assetType:asset.assetType||"asset",latestDate:latest.date,latestClose:current,ma:{ma20:snap.ma20,ma60:snap.ma60,ma120:snap.ma120,ma250:snap.ma250},rsi14:snap.rsi14,volumeConfirm:snap.volumeConfirm,dataQuality:quality,scores:{decisionScore:snap.decisionScore,trendScore:snap.trendScore,momentumScore:snap.momentumScore,riskScore:snap.riskScore,multiPeriodScore:Math.round(mean(periodResults.map(x=>x.score)))},backtest:bt,action,level,position,confidence,periodResults,warnings,entryRules,sparkline:closes.slice(-90)}
  }
  window.FPDecisionModel={analyzeAsset};
})();
