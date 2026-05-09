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


  const MODEL_PROFILES={
    semiconductor:{name:"半导体/存储模型",desc:"适合芯片、存储、设备、材料。更重视周期动量、成交量确认和海外科技映射。",riskMin:66,momentumMin:74,trendMin:72,prefer:"trend-growth"},
    ai_software:{name:"AI/软件模型",desc:"适合软件、云、AI应用、算力服务。更重视中期趋势、动量扩散和新闻情绪。",riskMin:60,momentumMin:76,trendMin:70,prefer:"growth"},
    biotech:{name:"医药/生物模型",desc:"适合创新药、疫苗、CXO、医疗器械。更重视回撤修复、事件催化和风险阻断。",riskMin:70,momentumMin:62,trendMin:66,prefer:"event-quality"},
    finance_bank:{name:"银行/保险模型",desc:"适合银行、保险和高股息金融。更重视低波动、回撤控制和趋势稳定。",riskMin:74,momentumMin:55,trendMin:60,prefer:"defensive-income"},
    broker:{name:"券商/金融弹性模型",desc:"适合券商、证券ETF。更重视市场情绪、成交额和β弹性。",riskMin:64,momentumMin:72,trendMin:66,prefer:"beta"},
    consumer_liquor:{name:"消费/白酒模型",desc:"适合食品饮料、白酒、品牌消费。更重视中长期趋势和回撤修复。",riskMin:70,momentumMin:60,trendMin:68,prefer:"quality"},
    new_energy:{name:"新能源/电动车模型",desc:"适合电池、光伏、储能、新能源车。更重视周期拐点和波动约束。",riskMin:64,momentumMin:72,trendMin:66,prefer:"cyclical-growth"},
    robotics:{name:"机器人/高端制造模型",desc:"适合机器人、自动化、工业母机。更重视主题扩散和成交量确认。",riskMin:62,momentumMin:74,trendMin:68,prefer:"theme-growth"},
    military:{name:"军工模型",desc:"适合军工、航空航天。更重视事件催化、趋势稳定和回撤控制。",riskMin:66,momentumMin:68,trendMin:66,prefer:"event"},
    energy_material:{name:"资源/能源/材料模型",desc:"适合煤炭、石油、有色、钢铁、化工。更重视价格周期和回撤约束。",riskMin:64,momentumMin:70,trendMin:66,prefer:"cyclical"},
    utility:{name:"公用事业/红利模型",desc:"适合电力、运营商、公用事业。更重视低波动、股息属性和趋势稳定。",riskMin:74,momentumMin:54,trendMin:60,prefer:"income"},
    real_estate:{name:"地产/建筑模型",desc:"适合地产、建筑、建材。更重视政策催化和风险阻断。",riskMin:66,momentumMin:66,trendMin:64,prefer:"policy"},
    fund_broad:{name:"宽基ETF模型",desc:"适合沪深300、创业板、科创50等宽基。更重视净值趋势、回撤和多周期稳定性。",riskMin:70,momentumMin:58,trendMin:64,prefer:"fund-broad"},
    fund_sector:{name:"行业ETF模型",desc:"适合半导体ETF、证券ETF、医药ETF等行业基金。继承行业属性并降低个股新闻权重。",riskMin:68,momentumMin:64,trendMin:64,prefer:"fund-sector"},
    bond_gold_qdii:{name:"债券/黄金/QDII模型",desc:"适合债基、黄金、海外指数基金。更重视回撤、汇率和低相关性。",riskMin:76,momentumMin:50,trendMin:58,prefer:"allocation"},
    default:{name:"通用稳健模型",desc:"适用于行业未知标的，默认风控优先。",riskMin:68,momentumMin:68,trendMin:68,prefer:"balanced"}
  };
  function inferModelProfile(asset){
    const text=[asset.symbol,asset.name,asset.industry,asset.sector,asset.assetType].filter(Boolean).join(" ").toLowerCase();
    const cn=[asset.name,asset.industry,asset.sector,asset.assetType].filter(Boolean).join(" ");
    const all=text+" "+cn;
    if(/bond|gold|qdii|债|黄金|纳指|标普|海外|qdii/i.test(all))return {key:"bond_gold_qdii",...MODEL_PROFILES.bond_gold_qdii};
    if(/etf|fund|lof|指数|基金|etf/i.test(all)){
      if(/半导体|芯片|证券|券商|医药|新能源|军工|传媒|消费|行业|sector|semi|broker|health|energy/i.test(all))return {key:"fund_sector",...MODEL_PROFILES.fund_sector};
      return {key:"fund_broad",...MODEL_PROFILES.fund_broad};
    }
    if(/semiconductor|chip|memory|storage|hbm|ic|电子|半导体|芯片|存储|集成电路/.test(all))return {key:"semiconductor",...MODEL_PROFILES.semiconductor};
    if(/software|cloud|internet|ai|artificial|人工智能|软件|云|算力|数据|信息技术|计算机/.test(all))return {key:"ai_software",...MODEL_PROFILES.ai_software};
    if(/biotech|pharma|medical|health|vaccine|生物|医药|医疗|疫苗|创新药|器械|cxo/i.test(all))return {key:"biotech",...MODEL_PROFILES.biotech};
    if(/broker|securities|券商|证券/.test(all))return {key:"broker",...MODEL_PROFILES.broker};
    if(/bank|insurance|银行|保险|高股息|红利/.test(all))return {key:"finance_bank",...MODEL_PROFILES.finance_bank};
    if(/liquor|consumer|food|drink|白酒|食品|饮料|消费/.test(all))return {key:"consumer_liquor",...MODEL_PROFILES.consumer_liquor};
    if(/battery|ev|solar|储能|光伏|新能源|电池|锂电|汽车/.test(all))return {key:"new_energy",...MODEL_PROFILES.new_energy};
    if(/robot|automation|machine|机器人|自动化|高端制造|工业母机/.test(all))return {key:"robotics",...MODEL_PROFILES.robotics};
    if(/military|defense|aerospace|军工|航空|航天|国防/.test(all))return {key:"military",...MODEL_PROFILES.military};
    if(/utility|telecom|power|公用|电力|运营商|通信服务/.test(all))return {key:"utility",...MODEL_PROFILES.utility};
    if(/real estate|property|construction|地产|房地产|建筑|建材/.test(all))return {key:"real_estate",...MODEL_PROFILES.real_estate};
    if(/energy|coal|oil|gas|steel|material|mining|煤炭|石油|有色|钢铁|化工|资源/.test(all))return {key:"energy_material",...MODEL_PROFILES.energy_material};
    return {key:"default",...MODEL_PROFILES.default};
  }
  function newsSentimentScore(asset){
    const news=Array.isArray(asset.news)?asset.news:[];
    if(!news.length)return Number.isFinite(Number(asset.sentimentScore))?Number(asset.sentimentScore):50;
    const pos=/增长|突破|上调|买入|强劲|创新高|盈利|超预期|合作|订单|涨|利好|beat|upgrade|growth|record|profit|strong/i;
    const neg=/下滑|风险|调查|处罚|亏损|低于预期|减持|暴跌|违约|裁员|跌|利空|miss|downgrade|loss|risk|probe|weak/i;
    let score=0;
    for(const item of news){
      const t=[item.title,item.summary].filter(Boolean).join(" ");
      if(pos.test(t))score+=1;
      if(neg.test(t))score-=1;
    }
    return clamp(50+score*10,0,100);
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


  function subModelScores(snap,bt,periodResults,sentimentScore){
    const trend=Math.round(snap.trendScore*0.45+snap.momentumScore*0.35+snap.riskScore*0.20);
    const pullback=Math.round((100-Math.abs(58-snap.rsi14))*0.35+snap.riskScore*0.35+snap.trendScore*0.30);
    const defense=Math.round(snap.riskScore*0.55+scoreVol(annualizedVolatility(periodResults.length?[]:[1,1]))*0+scoreRSI(snap.rsi14)*0.20+snap.trendScore*0.25);
    const sentiment=Math.round(sentimentScore*0.55+snap.momentumScore*0.25+snap.trendScore*0.20);
    const backtest=Math.round((bt.winRate*100)*0.35+(bt.wilsonLowerBound*100)*0.35+Math.min(100,bt.profitFactor*25)*0.20+Math.max(0,100-bt.maxConsecutiveLosses*18)*0.10);
    return {trend,pullback,defense,sentiment,backtest};
  }
  function makeDecisionReasons(resultLike){
    const reasons=[];
    const s=resultLike.scores,bt=resultLike.backtest,profile=resultLike.modelProfile;
    if(s.trendScore>=profile.trendMin)reasons.push(`趋势分 ${s.trendScore} 达到 ${profile.name} 的最低要求。`);
    else reasons.push(`趋势分 ${s.trendScore} 低于 ${profile.name} 要求 ${profile.trendMin}。`);
    if(s.momentumScore>=profile.momentumMin)reasons.push(`动量分 ${s.momentumScore} 达标。`);
    else reasons.push(`动量分 ${s.momentumScore} 不足，暂不适合进攻。`);
    if(s.riskScore>=profile.riskMin)reasons.push(`风险分 ${s.riskScore} 达标。`);
    else reasons.push(`风险分 ${s.riskScore} 偏低，应降低仓位或等待。`);
    if(bt.total>=bt.minSignals)reasons.push(`历史信号 ${bt.total} 次，满足最低样本数。`);
    else reasons.push(`历史信号仅 ${bt.total} 次，样本数不足。`);
    if(bt.winRate>=bt.targetWinRate)reasons.push(`历史胜率 ${(bt.winRate*100).toFixed(1)}% 达到目标。`);
    else reasons.push(`历史胜率 ${(bt.winRate*100).toFixed(1)}% 未达到目标。`);
    return reasons;
  }


  function marketRegimeAdjustment(market){
    const m=market||{};
    const risk=Number(m.riskScore ?? m.risk ?? 50);
    const breadth=Number(m.breadthScore ?? m.breadth ?? 50);
    const trend=Number(m.trendScore ?? m.trend ?? 50);
    const sentiment=Number(m.sentimentScore ?? m.sentiment ?? 50);
    const composite=Math.round(risk*0.30+breadth*0.25+trend*0.25+sentiment*0.20);
    if(composite>=75)return {name:"强势市场",score:composite,positionMultiplier:1.15,extraBlock:false};
    if(composite>=55)return {name:"中性市场",score:composite,positionMultiplier:1.0,extraBlock:false};
    if(composite>=40)return {name:"弱势市场",score:composite,positionMultiplier:0.65,extraBlock:false};
    return {name:"风险市场",score:composite,positionMultiplier:0.35,extraBlock:true};
  }
  function confidenceTier(resultLike){
    const bt=resultLike.backtest;
    const score=resultLike.scores.decisionScore;
    if(bt.pass && score>=86 && bt.wilsonLowerBound>=0.78 && bt.profitFactor>=1.8)return "A";
    if(score>=76 && bt.winRate>=0.70 && bt.profitFactor>=1.2)return "B";
    if(score>=62)return "C";
    return "D";
  }
  function adjustPosition(base, multiplier){
    const nums=String(base).match(/\d+/g);
    if(!nums||nums.length<2)return base;
    const lo=Math.round(Number(nums[0])*multiplier);
    const hi=Math.round(Number(nums[1])*multiplier);
    return `${Math.max(0,lo)}% - ${Math.max(lo,hi)}%`;
  }

  function analyzeAsset(asset,options={}){
    if(!asset||!Array.isArray(asset.prices))throw new Error("资产数据格式错误，缺少 prices。");
    const clean=asset.prices.filter(p=>Number(p.close)>0).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const quality=dataQuality({...asset,prices:clean});
    if(clean.length<300)throw new Error("历史数据不足。V6 至少需要约300个交易日。");
    const normalized={...asset,prices:clean};const profile=inferModelProfile(normalized);const sentimentScore=newsSentimentScore(normalized);const regime=marketRegimeAdjustment(options.market||asset.market||{});const closes=clean.map(p=>Number(p.close));const current=closes[closes.length-1];const latest=clean[clean.length-1];
    const periods=[["3M","3个月",63],["6M","6个月",126],["9M","9个月",189],["1Y","1年",252],["3Y","3年",756]];
    const periodResults=periods.map(([key,label,days])=>{const n=Math.min(days,closes.length-1);const slice=closes.slice(-n);const ret=pct(current,closes[closes.length-1-n]);const mdd=maxDrawdown(slice);const vol=annualizedVolatility(slice);return {key,label,returnPct:ret,maxDrawdownPct:mdd,volatilityPct:vol,score:Math.round(scoreReturn(ret)*0.40+scoreDrawdown(mdd)*0.32+scoreVol(vol)*0.28)}});
    const snap=calcSnapshot(normalized,clean.length);const bt=backtest(normalized,options);const blockers=[];
    if(snap.riskScore<profile.riskMin)blockers.push(`${profile.name}要求风险分至少 ${profile.riskMin}，当前 ${snap.riskScore}。`);
    if(snap.momentumScore<profile.momentumMin)blockers.push(`${profile.name}要求动量分至少 ${profile.momentumMin}，当前 ${snap.momentumScore}。`);
    if(snap.trendScore<profile.trendMin)blockers.push(`${profile.name}要求趋势分至少 ${profile.trendMin}，当前 ${snap.trendScore}。`);
    if(sentimentScore<35)blockers.push(`新闻情绪偏弱，情绪分 ${sentimentScore}。`);
    if(regime.extraBlock)blockers.push(`市场环境为${regime.name}，模型强制降低进攻等级。`);
    if(!bt.pass)blockers.push(`历史高置信回测未通过：胜率 ${(bt.winRate*100).toFixed(1)}%，Wilson下界 ${(bt.wilsonLowerBound*100).toFixed(1)}%。`);
    if(bt.total<bt.minSignals)blockers.push(`信号次数 ${bt.total} 次，少于最低门槛 ${bt.minSignals} 次。`);
    if(bt.profitFactor<1.6)blockers.push(`Profit Factor ${bt.profitFactor.toFixed(2)}，低于1.60。`);
    if(bt.maxConsecutiveLosses>3)blockers.push(`最大连续亏损 ${bt.maxConsecutiveLosses} 次，超过风控门槛。`);
    if(!snap.strictSignal)blockers.push("当前未触发严格趋势/动量/风险共振信号。");
    if(snap.rsi14>72)blockers.push("RSI偏热，追高风险上升。");
    let action="回避或仅观察",level="偏弱",position="0% - 10%",confidence="不达标";
    if(bt.pass&&snap.strictSignal&&snap.riskScore>=profile.riskMin&&snap.momentumScore>=profile.momentumMin&&snap.trendScore>=profile.trendMin&&sentimentScore>=35&&!regime.extraBlock){action="高置信：可小仓分批关注";level="高置信";position=adjustPosition("15% - 30%",regime.positionMultiplier);confidence="达标"}
    else if(snap.decisionScore>=76&&snap.riskScore>=60){action="等待回踩确认";level="可跟踪";position=adjustPosition("5% - 20%",regime.positionMultiplier);confidence="未达高置信门槛"}
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
    return {symbol:asset.symbol,name:asset.name||asset.symbol,assetType:asset.assetType||"asset",sector:asset.sector||"",industry:asset.industry||"",localWarning:asset.localWarning||"",latestDate:latest.date,latestClose:current,ma:{ma20:snap.ma20,ma60:snap.ma60,ma120:snap.ma120,ma250:snap.ma250},rsi14:snap.rsi14,volumeConfirm:snap.volumeConfirm,dataQuality:quality,modelProfile:profile,news:asset.news||[],sentimentScore,scores:{decisionScore:snap.decisionScore,trendScore:snap.trendScore,momentumScore:snap.momentumScore,riskScore:snap.riskScore,multiPeriodScore:Math.round(mean(periodResults.map(x=>x.score)))},backtest:bt,action,level,position,confidence,periodResults,warnings,entryRules,sparkline:closes.slice(-90),marketRegime:regime,confidenceTier:confidenceTier({scores:{decisionScore:snap.decisionScore},backtest:bt}),subModels:subModelScores(snap,bt,periodResults,sentimentScore),decisionReasons:makeDecisionReasons({scores:{decisionScore:snap.decisionScore,trendScore:snap.trendScore,momentumScore:snap.momentumScore,riskScore:snap.riskScore,multiPeriodScore:Math.round(mean(periodResults.map(x=>x.score)))},backtest:bt,modelProfile:profile})}
  }
  const root=typeof self!=="undefined"?self:(typeof window!=="undefined"?window:globalThis);root.FPDecisionModel={analyzeAsset,inferModelProfile};
})();
