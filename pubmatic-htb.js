/**
 * @author:    Partner
 * @license:   UNLICENSED
 *
 * @copyright: Copyright (c) 2017 by Index Exchange. All rights reserved.
 *
 * The information contained within this document is confidential, copyrighted
 * and or a trade secret. No part of this document may be reproduced or
 * distributed in any form or by any means, in whole or in part, without the
 * prior written permission of Index Exchange.
 */

'use strict';

////////////////////////////////////////////////////////////////////////////////
// Dependencies ////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

var Browser = require('browser.js');
var Classify = require('classify.js');
var Constants = require('constants.js');
var Prms = require('prms.js');
var Partner = require('partner.js');
var Size = require('size.js');
var SpaceCamp = require('space-camp.js');
var System = require('system.js');
var Utilities = require('utilities.js');
var Whoopsie = require('whoopsie.js');

var EventsService;
var RenderService;

//? if (DEBUG) {
var ConfigValidators = require('config-validators.js');
var PartnerSpecificValidator = require('pubmatic-htb-validator.js');
var Scribe = require('scribe.js');
//? }

////////////////////////////////////////////////////////////////////////////////
// Main ////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

/**
 * The Pubmatic Module
 *
 * @class
 */
function PubmaticHtb(configs) {
    /* =====================================
     * Data
     * ---------------------------------- */

    /* Private
     * ---------------------------------- */

    /**
     * @private
     * @type {Object}
     */
    var __baseClass;

    /**
     * @private
     * @type {Object}
     */
    var __profile;

    /**
     * Base URL for the bidding end-point.
     *
     * @private {string}
     */
    var __baseUrl;

    /**
     * Temporary storage for different sessions.
     *
     * @private {object}
     */
    var __requestStore;

    /**
     * Pubmatic publisher id.
     *
     * @private {integer}
     */
    var __publisherId;

    /* Public
     * ---------------------------------- */

    var adResponseCallbacks;

    /* =====================================
     * Functions
     * ---------------------------------- */

    /* Helpers
     * ---------------------------------- */

    /**
     * This function will render Pubmatic pixel.
     * @param  {string} pixel The tracking pixel code that came with the original demand.
     */
    function __renderPixel(pixel) {
        Browser.createHiddenIFrame(pixel);
    }

    /**
     * Parses pubmatic demand and appends any demand into outParcels.
     * @param  {Object} sessionId The current session identifier.
     * @param  {string} returnParcels The parcels that will be returned.
     * @param  {string} outstandingXSlotNames The remaining xSlots.
     */
    function __parseResponse(sessionId, requestId, returnParcels, outstandingXSlotNames) {
        var currentIframe = __requestStore[requestId].iframe;
        var progKeyValueMap = currentIframe.contentWindow.progKeyValueMap;
        var bidDetailsMap = currentIframe.contentWindow.bidDetailsMap;

        var unusedReturnParcels = returnParcels.slice();

        for (var adSlotId in bidDetailsMap) {
            if (!bidDetailsMap.hasOwnProperty(adSlotId)) {
                continue;
            }

            /* Details about the bid from the response  */
            var bidDetails = bidDetailsMap[adSlotId];

            /* Parse the bidKeyValMap since it is returned as a string */
            var bidKeyValMap = progKeyValueMap[adSlotId];

            /* Find correct parcel based on pubmatic "adSlotId" */
            var curReturnParcel;
            var curAdSlotId;
            for (var j = unusedReturnParcels.length - 1; j >= 0; j--) {
                curAdSlotId = unusedReturnParcels[j].xSlotRef.adUnitName + '@' + Size.arrayToString(unusedReturnParcels[j].xSlotRef.size);
                if (curAdSlotId === adSlotId) {
                    curReturnParcel = unusedReturnParcels[j];
                    unusedReturnParcels.splice(j, 1);

                    break;
                }
            }

            /* If no match */
            if (!curReturnParcel) {
                continue;
            }

            var bidPriceLevel = bidDetails.ecpm;
            var bidDealId = bidKeyValMap.split(/wdeal.(.*?)(;|$)/)[1];
            var bidStatus = bidKeyValMap.split(/bidstatus.(.*?)(;|$)/)[1];

            var curHtSlotId = curReturnParcel.htSlot.getId();
            var headerStatsInfo = {
                sessionId: sessionId,
                statsId: __profile.statsId,
                htSlotId: curHtSlotId,
                requestId: curReturnParcel.requestId,
                xSlotNames: [curReturnParcel.xSlotName]
            };

            if (outstandingXSlotNames[curHtSlotId] && outstandingXSlotNames[curHtSlotId][curReturnParcel.requestId]) {
                Utilities.arrayDelete(outstandingXSlotNames[curHtSlotId][curReturnParcel.requestId], curReturnParcel.xSlotName);
            }

            /* Bid status not 1 is a pass */
            if (bidStatus !== '1' || bidPriceLevel <= 0) {
                //? if (DEBUG) {
                Scribe.info(__profile.partnerId + ' price was zero or did not meet floor for { id: ' + adSlotId + ' }.');
                //? }
                curReturnParcel.pass = true;

                if (__profile.enabledAnalytics.requestTime) {
                    EventsService.emit('hs_slot_pass', headerStatsInfo);
                }

                continue;
            }

            if (__profile.enabledAnalytics.requestTime) {
                EventsService.emit('hs_slot_bid', headerStatsInfo);
            }

            var bidCreative = decodeURIComponent(bidDetails.creative_tag);
            var trackingUrl = decodeURIComponent(bidDetails.tracking_url);
            var bidSize = [Number(bidDetails.width), Number(bidDetails.height)];

            curReturnParcel.targetingType = 'slot';
            curReturnParcel.targeting = {};
            curReturnParcel.size = bidSize;
            var targetingCpm = '';

            //? if(FEATURES.GPT_LINE_ITEMS) {
            var sizeKey = Size.arrayToString(bidSize);
            targetingCpm = __baseClass._bidTransformers.targeting.apply(bidPriceLevel);

            if (bidDealId) {
                curReturnParcel.targeting[__baseClass._configs.targetingKeys.pm] = [sizeKey + '_' + targetingCpm];
                curReturnParcel.targeting[__baseClass._configs.targetingKeys.pmid] = [sizeKey + '_' + bidDealId];
            } else {
                curReturnParcel.targeting[__baseClass._configs.targetingKeys.om] = [sizeKey + '_' + targetingCpm];
            }
            curReturnParcel.targeting[__baseClass._configs.targetingKeys.id] = [curReturnParcel.requestId];
            //? }

            //? if(FEATURES.RETURN_CREATIVE) {
            curReturnParcel.adm = bidCreative;
            if (trackingUrl) {
                curReturnParcel.winNotice = __renderPixel.bind(null, trackingUrl);
            }
            //? }

            //? if(FEATURES.RETURN_PRICE) {
            curReturnParcel.price = Number(__baseClass._bidTransformers.price.apply(bidPriceLevel));
            //? }

            var pubKitAdId = RenderService.registerAd({
                sessionId: sessionId,
                partnerId: __profile.partnerId,
                adm: bidCreative,
                requestId: curReturnParcel.requestId,
                size: bidSize,
                price: targetingCpm ? targetingCpm : undefined,
                dealId: bidDealId ? bidDealId : undefined,
                timeOfExpiry: __profile.features.demandExpiry.enabled ? (__profile.features.demandExpiry.value + System.now()) : 0,
                auxFn: __renderPixel,
                auxArgs: [trackingUrl]
            });

            //? if(FEATURES.INTERNAL_RENDER) {
            curReturnParcel.targeting.pubKitAdId = pubKitAdId;
            //? }
        }

        /* Any requests that didn't get a response above are passes */
        for (var k = 0; k < unusedReturnParcels.length; k++) {
            unusedReturnParcels[k].pass = true;
        }

        if (__profile.enabledAnalytics.requestTime) {
            __baseClass._emitStatsEvent(sessionId, 'hs_slot_pass', outstandingXSlotNames);
        }
    }

    /**
     * Returns pubmatic adSlotIds in the correct format for pubmatic's lib to read.
     * @param  {Object} parcels The parcels that contain the required slots to be requested.
     */
    function __getPubmaticAdSlotIds(parcels) {
        var adSlotIds = [];
        var adSlotId;

        for (var j = 0; j < parcels.length; j++) {
            adSlotId = parcels[j].xSlotRef.adUnitName + '@' + Size.arrayToString(parcels[j].xSlotRef.size);
            adSlotIds.push(adSlotId);
        }

        return adSlotIds;
    }

    /**
     * Returns a unique demand request callback based on the provided sessionId & requestId
     * @param  {Object} sessionId The current session identifier.
     * @param  {Object} requestId The current request identifier.
     */
    function __generateAdResponseCallback(sessionId, requestId) {
        return function () {
            delete adResponseCallbacks[requestId];

            if (!__requestStore.hasOwnProperty(requestId)) {
                return;
            }

            var returnParcels = __requestStore[requestId].returnParcels;
            EventsService.emit('partner_request_complete', {
                partner: __profile.partnerId,
                status: 'success',
                //? if (DEBUG) {
                parcels: returnParcels,
                request: __baseUrl
                //? }
            });

            __parseResponse(sessionId, requestId, returnParcels, __requestStore[requestId].xSlotNames);

            var defer = __requestStore[requestId].defer;
            delete __requestStore[requestId];
            defer.resolve(returnParcels);
        };
    }

    /**
     * Returns a unique timeout  callback based on the provided sessionId, used by the timer service.
     * @param  {Object} sessionId The current session identifier.
     * @param  {Object} requestId The current request identifier.
     */
    function __generateTimeoutCallback(sessionId, requestId) {
        return function () {
            if (!__requestStore.hasOwnProperty(requestId)) {
                return;
            }

            var returnParcels = __requestStore[requestId].returnParcels;

            EventsService.emit('partner_request_complete', {
                partner: __profile.partnerId,
                status: 'timeout',
                //? if (DEBUG) {
                parcels: returnParcels,
                request: __baseUrl
                //? }
            });

            var xSlotNames = __requestStore[requestId].xSlotNames;
            if (__profile.enabledAnalytics.requestTime) {
                __baseClass._emitStatsEvent(sessionId, 'hs_slot_timeout', xSlotNames);
            }

            var defer = __requestStore[requestId].defer;
            delete __requestStore[requestId];
            defer.resolve(returnParcels);
        };
    }

    function __generateIFrameContents(pmPubId, pmOptimizeAdSlots, pmAsyncCallbackFn) {
        // eslint-disable-next-line no-useless-concat
        return '<!DOCTYPE html><html><head></head><body><scr' + 'ipt type="text/javascript">window.pm_pub_id = "' + pmPubId + '"; window.pm_optimize_adslots = ' + JSON.stringify(pmOptimizeAdSlots) + '; window.pm_async_callback_fn = "' + pmAsyncCallbackFn + '";</scr' + 'ipt><scr' + 'ipt src="' + Browser.getProtocol() + '//ads.pubmatic.com/AdServer/js/gshowad.js"></scr' + 'ipt></body></html>';
    }

    /* Main
     * ---------------------------------- */

    function __sendDemandRequest(sessionId, returnParcels) {
        // Create a new deferred promise
        var defer = Prms.defer();

        var xSlotNames = {};

        /* Generate a unique request identifier for storing request-specific information */
        var requestId = '_' + System.generateUniqueId();

        if (__profile.enabledAnalytics.requestTime) {
            for (var i = 0; i < returnParcels.length; i++) {
                var parcel = returnParcels[i];
                var htSlotId = parcel.htSlot.getId();

                if (!xSlotNames.hasOwnProperty(htSlotId)) {
                    xSlotNames[htSlotId] = {};
                }

                if (!xSlotNames[htSlotId].hasOwnProperty(parcel.requestId)) {
                    xSlotNames[htSlotId][parcel.requestId] = [];
                }

                xSlotNames[htSlotId][parcel.requestId].push(parcel.xSlotName);
            }

            __baseClass._emitStatsEvent(sessionId, 'hs_slot_request', xSlotNames);
        }

        /* Generate unique callback */
        adResponseCallbacks[requestId] = __generateAdResponseCallback(sessionId, requestId);

        /* Generate a unique iframe for pubmatic request  */
        var iframe = Browser.createHiddenIFrame(null, window);

        /* Setup and start timers. */
        var timeoutCallback = __generateTimeoutCallback(sessionId, requestId);

        if (configs.timeout) {
            setTimeout(timeoutCallback, configs.timeout);
        }

        // Register a custom timeout callback
        SpaceCamp.services.TimerService.addTimerCallback(sessionId, timeoutCallback);

        System.documentWrite(
            iframe.contentDocument,
            __generateIFrameContents(
                __publisherId,
                __getPubmaticAdSlotIds(returnParcels),
                'window.parent.' + SpaceCamp.NAMESPACE + '.' + __profile.namespace + '.adResponseCallbacks.' + requestId
            )
        );

        /* Store request sepcific info in requestStore */
        __requestStore[requestId] = {
            defer: defer,
            xSlotNames: xSlotNames,
            returnParcels: returnParcels,
            iframe: iframe
        };

        EventsService.emit('partner_request_sent', {
            partner: __profile.partnerId,
            //? if (DEBUG) {
            parcels: returnParcels,
            request: __baseUrl
            //? }
        });

        return defer.promise;
    }

    /* Send requests for all slots in inParcels */
    function __retriever(sessionId, inParcels) {
        var returnParcelSets = __baseClass._generateReturnParcels(inParcels);
        var demandRequestPromises = [];

        for (var i = 0; i < returnParcelSets.length; i++) {
            demandRequestPromises.push(__sendDemandRequest(sessionId, returnParcelSets[i]));
        }

        return demandRequestPromises;
    }

    /* =====================================
     * Constructors
     * ---------------------------------- */

    (function __constructor() {
        RenderService = SpaceCamp.services.RenderService;
        EventsService = SpaceCamp.services.EventsService;

        __profile = {
            partnerId: 'PubmaticHtb',
            namespace: 'PubmaticHtb',
            statsId: 'PUBM',
            version: '2.1.2',
            targetingType: 'slot',
            enabledAnalytics: {
                requestTime: true
            },
            features: {
                demandExpiry: {
                    enabled: false,
                    value: 0
                },
                rateLimiting: {
                    enabled: false,
                    value: 0
                },
                prefetchDisabled: {
                    enabled: true
                }
            },
            targetingKeys: {
                om: 'ix_pubm_om',
                pm: 'ix_pubm_pm',
                pmid: 'ix_pubm_pmid',
                id: 'ix_pubm_id'
            },
            bidUnitInCents: 100,
            lineItemType: Constants.LineItemTypes.ID_AND_SIZE,
            callbackType: Partner.CallbackTypes.CALLBACK_NAME,
            architecture: Partner.Architectures.SRA,
            requestType: Partner.RequestTypes.JSONP
        };

        //? if (DEBUG) {
        var results = ConfigValidators.partnerBaseConfig(configs) || PartnerSpecificValidator(configs);

        if (results) {
            throw Whoopsie('INVALID_CONFIG', results);
        }
        //? }

        __baseUrl = Browser.getProtocol() + '//ads.pubmatic.com/AdServer/js/gshowad.js';

        // Write pubmatic pub id && callback
        __publisherId = Number(configs.publisherId);

        // Initialize session store

        __requestStore = {};

        __baseClass = Partner(__profile, configs, null, {
            retriever: __retriever
        });

        adResponseCallbacks = {};

        __baseClass._setDirectInterface({
            adResponseCallbacks: adResponseCallbacks
        });
    })();

    /* =====================================
     * Public Interface
     * ---------------------------------- */

    var derivedClass = {
        /* Class Information
         * ---------------------------------- */

        //? if (DEBUG) {
        __type__: 'PubmaticHtb',
        //? }

        //? if (TEST) {
        __baseClass: __baseClass,
        //? }

        /* Data
         * ---------------------------------- */

        //? if (TEST) {
        __profile: __profile,
        __baseUrl: __baseUrl,
        //? }

        /* Functions
         * ---------------------------------- */

        //? if (TEST) {
        __parseResponse: __parseResponse
        //? }
    };

    return Classify.derive(__baseClass, derivedClass);
}

////////////////////////////////////////////////////////////////////////////////
// Exports /////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

module.exports = PubmaticHtb;
