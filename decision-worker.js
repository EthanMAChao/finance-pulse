importScripts('./model.js');

self.onmessage = function(event) {
  try {
    const { asset, options } = event.data || {};
    const result = self.FPDecisionModel.analyzeAsset(asset, options || {});
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
  }
};
