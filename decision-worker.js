importScripts('./model.js');

self.onmessage = function(event) {
  try {
    const { asset, options } = event.data || {};
    if (!self.FPDecisionModel || !self.FPDecisionModel.analyzeAsset) {
      throw new Error('模型模块未正确加载');
    }
    const result = self.FPDecisionModel.analyzeAsset(asset, options || {});
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
  }
};
