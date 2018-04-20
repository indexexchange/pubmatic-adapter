//? if(FEATURES.GPT_LINE_ITEMS) {
shellInterface.PubmaticHtb = {
    render: SpaceCamp.services.RenderService.renderDfpAd.bind(null, 'PubmaticHtb')
};

shellInterface.PubmaticModule = {
    render: SpaceCamp.services.RenderService.renderDfpAd.bind(null, 'PubmaticHtb')
};
//? }

if (__directInterface.Layers.PartnersLayer.Partners.PubmaticHtb) {
    shellInterface.PubmaticHtb = shellInterface.PubmaticHtb || {};
    shellInterface.PubmaticHtb.adResponseCallbacks = __directInterface.Layers.PartnersLayer.Partners.PubmaticHtb.adResponseCallbacks
}
