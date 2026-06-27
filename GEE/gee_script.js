// ============================================================
// CROP HEALTH MONITOR — Google Earth Engine (Universal Config)
// Multi-satellite tiered fallback with full statistics export.
// EDIT ONLY THE CONFIG BLOCK BELOW TO CUSTOMIZE FOR ANY FIELD,
// CROP, SENSOR SET, OR THRESHOLD PROFILE.
// ============================================================

// ============================================================
// ====================== CONFIG BLOCK =========================
// Change anything here. Nothing below this block needs editing
// for normal customization.
// ============================================================
var CONFIG = {

  // ---- Field / Region of Interest ----
  // Provide either a polygon (array of [lng, lat] pairs) or swap
  // this for ee.Geometry.Rectangle / ee.FeatureCollection as needed.
  FIELD_COORDS: [
    [74.83539557596407, 32.08584387174885],
    [74.83878226340413, 32.08700524230657],
    [74.83908309667169, 32.08996200789861],
    [74.83417368877375, 32.08993782137541],
    [74.83539557596407, 32.08584387174885]
  ],

  // ---- Index thresholds (below threshold = "stressed") ----
  // Edit per crop type / growth stage / region. Add or remove
  // keys here; the rest of the script reads this dynamically.
  THRESHOLDS: {
    NDVI:  0.35,
    EVI:   0.20,
    NDRE:  0.20,
    GNDVI: 0.30,
    NDMI:  0.10,
    SAVI:  0.25,
    MSAVI: 0.25
  },

  // ---- Human-readable labels + explanations per index ----
  // Edit wording for different crops/audiences. healthyMsg shown
  // when NOT stressed, stressedMsg shown when stressed.
  INDEX_INFO: {
    NDVI:  { fullName: 'Vegetation Health',     healthyMsg: 'Crops are green and growing well.',          stressedMsg: 'Crops look weak or sparse — check fertilizer.' },
    EVI:   { fullName: 'Dense Crop Health',      healthyMsg: 'Dense crop areas are healthy.',              stressedMsg: 'Dense crop areas show stress — check nutrients.' },
    NDRE:  { fullName: 'Early Stress Detector',  healthyMsg: 'No early stress detected.',                  stressedMsg: 'Early stress detected — check nitrogen.' },
    GNDVI: { fullName: 'Chlorophyll Level',      healthyMsg: 'Chlorophyll levels look good.',              stressedMsg: 'Low chlorophyll — leaves may be yellowing.' },
    NDMI:  { fullName: 'Water Content',          healthyMsg: 'Water levels look fine.',                    stressedMsg: 'Drought stress — consider irrigating soon.' },
    SAVI:  { fullName: 'Soil-Adjusted Health',   healthyMsg: 'Plant coverage looks normal.',               stressedMsg: 'Low plant cover — crops may be thin/young.' },
    MSAVI: { fullName: 'Modified Soil Health',   healthyMsg: 'Vegetation cover is sufficient.',            stressedMsg: 'Vegetation cover is low — check replanting.' }
  },

  // ---- Overall status classification ----
  // Number of stressed indices -> status label.
  STATUS_RULES: {
    HEALTHY_MAX_STRESSED:  0, // 0 stressed indices = HEALTHY
    WARNING_MAX_STRESSED:  2  // 1-2 stressed = WARNING, 3+ = CRITICAL
  },

  // ---- Time windows ----
  PRIMARY_WINDOW_DAYS:  10, // Pass 1 — tried first across all sensors
  FALLBACK_WINDOW_DAYS: 16, // Pass 2 — only if ALL sensors fail Pass 1

  // ---- Cloud filtering ----
  TILE_CLOUD_LIMIT: 20, // whole-scene cloud % filter (0-100)

  // ---- Sensor priority order ----
  // List sensor keys in the order you want them tried.
  // Supported keys: 'S2', 'L9', 'L8', 'MODIS'
  // Remove a key to disable that sensor entirely.
  SENSOR_PRIORITY: ['S2', 'L9', 'L8', 'MODIS'],

  // ---- Sensor collection IDs (only edit if GEE renames a collection) ----
  COLLECTIONS: {
    S2:    'COPERNICUS/S2_SR_HARMONIZED',
    L9:    'LANDSAT/LC09/C02/T1_L2',
    L8:    'LANDSAT/LC08/C02/T1_L2',
    MODIS: 'MODIS/061/MOD09GA'
  },

  // ---- Per-sensor cloud field names (only edit if GEE renames a field) ----
  CLOUD_FIELD: {
    S2: 'CLOUDY_PIXEL_PERCENTAGE',
    L9: 'CLOUD_COVER',
    L8: 'CLOUD_COVER'
    // MODIS has no scene-level cloud field; per-pixel QA not applied here
  },

  // ---- Output ----
  OUTPUT_FOLDER:   'CropHealthReports',
  OUTPUT_FILENAME: 'summary',
  OUTPUT_FORMAT:   'CSV', // CSV is required for the current email script

  // ---- Spatial analysis settings ----
  ANALYSIS_SCALE_METERS: 20,   // pixel scale for stats (raise for huge fields to save compute)
  MAX_PIXELS:            1e9,
  TILE_SCALE:            2,    // raise if you hit "too many pixels" errors

  // ---- Field size sanity-check bounds (hectares) ----
  MIN_FIELD_HA: 0.05,
  MAX_FIELD_HA: 5000
};
// ============================================================
// ==================== END CONFIG BLOCK ========================
// ============================================================


// ============================================================
// SETUP — derived from CONFIG, no manual edits needed below
// ============================================================
var field = ee.Geometry.Polygon([CONFIG.FIELD_COORDS]);
Map.centerObject(field, 15);
Map.addLayer(field, {color: 'yellow'}, 'Field Boundary');

var endDate = ee.Date(Date.now());
var thresholdMap = CONFIG.THRESHOLDS;
var indexNamesList = Object.keys(thresholdMap);

// ============================================================
// SENSOR FETCH FUNCTIONS
// ============================================================
function maskS2(image) {
  var scl = image.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9))
    .and(scl.neq(10)).and(scl.neq(11));
  return image.updateMask(mask);
}

function maskLandsat(image) {
  var qa = image.select('QA_PIXEL');
  var cloud = 1 << 3;
  var cloudShadow = 1 << 4;
  var mask = qa.bitwiseAnd(cloud).eq(0).and(qa.bitwiseAnd(cloudShadow).eq(0));
  return image.updateMask(mask);
}

function getCollection(sensorKey, windowDays) {
  var collectionId = CONFIG.COLLECTIONS[sensorKey];
  var base = ee.ImageCollection(collectionId)
    .filterBounds(field)
    .filterDate(endDate.advance(-windowDays, 'day'), endDate);

  var cloudField = CONFIG.CLOUD_FIELD[sensorKey];
  if (cloudField) {
    base = base.filter(ee.Filter.lt(cloudField, CONFIG.TILE_CLOUD_LIMIT));
  }

  if (sensorKey === 'S2') {
    base = base.map(maskS2);
  } else if (sensorKey === 'L9' || sensorKey === 'L8') {
    base = base.map(maskLandsat);
  }

  return base.sort('system:time_start', false);
}

// ============================================================
// FETCH PASS 1 AND PASS 2 FOR EACH ENABLED SENSOR
// ============================================================
var pass1 = {}; // sensorKey -> collection
var pass2 = {};
var count1 = {}; // sensorKey -> ee.Number count
var count2 = {};

for (var s = 0; s < CONFIG.SENSOR_PRIORITY.length; s++) {
  var key = CONFIG.SENSOR_PRIORITY[s];
  pass1[key] = getCollection(key, CONFIG.PRIMARY_WINDOW_DAYS);
  pass2[key] = getCollection(key, CONFIG.FALLBACK_WINDOW_DAYS);
  count1[key] = pass1[key].size();
  count2[key] = pass2[key].size();
}

// allFailedPass1 = true only if every enabled sensor returned 0 images
var allFailedPass1 = ee.Number(1); // start true, AND together
for (var s2i = 0; s2i < CONFIG.SENSOR_PRIORITY.length; s2i++) {
  var k2 = CONFIG.SENSOR_PRIORITY[s2i];
  allFailedPass1 = allFailedPass1.min(count1[k2].eq(0) ? 1 : 0); // placeholder, replaced below
}
// Rebuild properly using ee boolean chaining (server-side):
allFailedPass1 = ee.Number(1).eq(1); // true
for (var s3i = 0; s3i < CONFIG.SENSOR_PRIORITY.length; s3i++) {
  var k3 = CONFIG.SENSOR_PRIORITY[s3i];
  allFailedPass1 = allFailedPass1.and(count1[k3].eq(0));
}

// ============================================================
// SELECT WHICH SENSOR/PASS TO USE, IN PRIORITY ORDER
// First enabled sensor with images in Pass 1 wins; if NONE have
// Pass 1 images, fall through to Pass 2 in the same priority order.
// ============================================================
var useFlag = {}; // sensorKey -> ee.Boolean (true if this sensor+pass is the chosen one)
var chosenSoFarP1 = ee.Number(0).eq(1); // false
for (var p1i = 0; p1i < CONFIG.SENSOR_PRIORITY.length; p1i++) {
  var pk1 = CONFIG.SENSOR_PRIORITY[p1i];
  var thisUsesP1 = allFailedPass1.not().and(chosenSoFarP1.not()).and(count1[pk1].gt(0));
  useFlag[pk1 + '_p1'] = thisUsesP1;
  chosenSoFarP1 = chosenSoFarP1.or(thisUsesP1);
}

var chosenSoFarP2 = ee.Number(0).eq(1); // false
for (var p2i = 0; p2i < CONFIG.SENSOR_PRIORITY.length; p2i++) {
  var pk2 = CONFIG.SENSOR_PRIORITY[p2i];
  var thisUsesP2 = allFailedPass1.and(chosenSoFarP2.not()).and(count2[pk2].gt(0));
  useFlag[pk2 + '_p2'] = thisUsesP2;
  chosenSoFarP2 = chosenSoFarP2.or(thisUsesP2);
}

// Combined "is this sensor the one in use, regardless of pass" flag
var useSensor = {};
for (var ci = 0; ci < CONFIG.SENSOR_PRIORITY.length; ci++) {
  var ck = CONFIG.SENSOR_PRIORITY[ci];
  useSensor[ck] = useFlag[ck + '_p1'].or(useFlag[ck + '_p2']);
}

// tierUsed: nested If chain built dynamically from SENSOR_PRIORITY
var tierUsed = ee.String('NONE');
for (var ti = CONFIG.SENSOR_PRIORITY.length - 1; ti >= 0; ti--) {
  var tk = CONFIG.SENSOR_PRIORITY[ti];
  tierUsed = ee.String(ee.Algorithms.If(useSensor[tk], tk, tierUsed));
}

var usedFallback = allFailedPass1;

// rawImage: nested If chain picking .first() from whichever pass/sensor is active
var rawImage = null;
var fallbackDummy = pass2[CONFIG.SENSOR_PRIORITY[0]].first(); // dummy to avoid null
var imageChain = fallbackDummy;
for (var ri = CONFIG.SENSOR_PRIORITY.length - 1; ri >= 0; ri--) {
  var rk = CONFIG.SENSOR_PRIORITY[ri];
  imageChain = ee.Image(ee.Algorithms.If(useFlag[rk + '_p2'], pass2[rk].first(), imageChain));
}
for (var ri2 = CONFIG.SENSOR_PRIORITY.length - 1; ri2 >= 0; ri2--) {
  var rk2 = CONFIG.SENSOR_PRIORITY[ri2];
  imageChain = ee.Image(ee.Algorithms.If(useFlag[rk2 + '_p1'], pass1[rk2].first(), imageChain));
}
rawImage = imageChain;

var sentinel2 = rawImage; // kept variable name for compatibility with band logic below

// Reproject MODIS into EPSG:4326 to match field geometry (fixes clip/reduceRegion errors)
var usesModisFlag = useSensor.MODIS ? useSensor.MODIS : ee.Number(0).eq(1);
sentinel2 = ee.Image(ee.Algorithms.If(usesModisFlag,
  sentinel2.reproject(ee.Projection('EPSG:4326').atScale(463.3127165279165)),
  sentinel2
));

var imageDate = ee.Date(sentinel2.get('system:time_start')).format('YYYY-MM-dd');
var hasNDRE = useSensor.S2 ? useSensor.S2 : ee.Number(0).eq(1); // only Sentinel-2 has Red Edge

// ============================================================
// BAND EXTRACTION — standardized per-sensor
// (Add a new sensor's band math here if you add one to COLLECTIONS)
// ============================================================
var useS2flag    = useSensor.S2    ? useSensor.S2    : ee.Number(0).eq(1);
var useL9flag    = useSensor.L9    ? useSensor.L9    : ee.Number(0).eq(1);
var useL8flag    = useSensor.L8    ? useSensor.L8    : ee.Number(0).eq(1);
var useLandsat   = useL9flag.or(useL8flag);

var BLUE = ee.Image(ee.Algorithms.If(useS2flag, sentinel2.select('B2').divide(10000),
  ee.Algorithms.If(useLandsat, sentinel2.select('SR_B2').multiply(0.0000275).add(-0.2),
  sentinel2.select('sur_refl_b03').multiply(0.0001))));

var GREEN = ee.Image(ee.Algorithms.If(useS2flag, sentinel2.select('B3').divide(10000),
  ee.Algorithms.If(useLandsat, sentinel2.select('SR_B3').multiply(0.0000275).add(-0.2),
  sentinel2.select('sur_refl_b04').multiply(0.0001))));

var RED = ee.Image(ee.Algorithms.If(useS2flag, sentinel2.select('B4').divide(10000),
  ee.Algorithms.If(useLandsat, sentinel2.select('SR_B4').multiply(0.0000275).add(-0.2),
  sentinel2.select('sur_refl_b01').multiply(0.0001))));

var RED_EDGE = ee.Image(ee.Algorithms.If(useS2flag, sentinel2.select('B5').divide(10000), RED));

var NIR = ee.Image(ee.Algorithms.If(useS2flag, sentinel2.select('B8').divide(10000),
  ee.Algorithms.If(useLandsat, sentinel2.select('SR_B5').multiply(0.0000275).add(-0.2),
  sentinel2.select('sur_refl_b02').multiply(0.0001))));

var SWIR = ee.Image(ee.Algorithms.If(useS2flag, sentinel2.select('B11').divide(10000),
  ee.Algorithms.If(useLandsat, sentinel2.select('SR_B6').multiply(0.0000275).add(-0.2),
  sentinel2.select('sur_refl_b06').multiply(0.0001))));

BLUE = BLUE.rename('BLUE'); GREEN = GREEN.rename('GREEN'); RED = RED.rename('RED');
RED_EDGE = RED_EDGE.rename('RED_EDGE'); NIR = NIR.rename('NIR'); SWIR = SWIR.rename('SWIR');

// ============================================================
// INDEX CALCULATIONS
// (Add a new index here + to CONFIG.THRESHOLDS + CONFIG.INDEX_INFO
// if you want to track something beyond these 7)
// ============================================================
var NDVI  = NIR.subtract(RED).divide(NIR.add(RED)).rename('NDVI');
var EVI   = NIR.subtract(RED)
  .divide(NIR.add(RED.multiply(6)).subtract(BLUE.multiply(7.5)).add(1))
  .multiply(2.5).rename('EVI');
var NDRE  = NIR.subtract(RED_EDGE).divide(NIR.add(RED_EDGE)).rename('NDRE');
var GNDVI = NIR.subtract(GREEN).divide(NIR.add(GREEN)).rename('GNDVI');
var NDMI  = NIR.subtract(SWIR).divide(NIR.add(SWIR)).rename('NDMI');
var SAVI  = NIR.subtract(RED).divide(NIR.add(RED).add(0.5)).multiply(1.5).rename('SAVI');
var MSAVI = NIR.multiply(2).add(1)
  .subtract(NIR.multiply(2).add(1).pow(2).subtract(NIR.subtract(RED).multiply(8)).sqrt())
  .divide(2).rename('MSAVI');

var allIndexBands = {
  NDVI: NDVI, EVI: EVI, NDRE: NDRE, GNDVI: GNDVI, NDMI: NDMI, SAVI: SAVI, MSAVI: MSAVI
};

var allIndices = null;
for (var bi = 0; bi < indexNamesList.length; bi++) {
  var bname = indexNamesList[bi];
  allIndices = allIndices === null ? allIndexBands[bname] : allIndices.addBands(allIndexBands[bname]);
}

// ---- FULL STATISTICS: mean, min, max, stdDev, per index ----
var statsReducer = ee.Reducer.mean()
  .combine(ee.Reducer.minMax(), '', true)
  .combine(ee.Reducer.stdDev(), '', true);

var fullStats = allIndices.reduceRegion({
  reducer: statsReducer,
  geometry: field,
  scale: CONFIG.ANALYSIS_SCALE_METERS,
  maxPixels: CONFIG.MAX_PIXELS,
  tileScale: CONFIG.TILE_SCALE
});

// ---- % of field stressed per index (pixel-level threshold comparison) ----
var stressPercentImages = {};
for (var k = 0; k < indexNamesList.length; k++) {
  var nm = indexNamesList[k];
  stressPercentImages[nm] = allIndices.select(nm).lt(thresholdMap[nm]).rename(nm + '_stressed');
}
var stressedImageList = [];
for (var sk = 0; sk < indexNamesList.length; sk++) {
  stressedImageList.push(stressPercentImages[indexNamesList[sk]]);
}
var stressedImage = ee.Image.cat(stressedImageList);
for (var sk = 0; sk < indexNamesList.length; sk++) {
  stressedImageList.push(stressPercentImages[indexNamesList[sk]]);
}
var stressedImage = ee.Image.cat(stressedImageList);
var stressPercentStats = stressedImage.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: field,
  scale: CONFIG.ANALYSIS_SCALE_METERS,
  maxPixels: CONFIG.MAX_PIXELS,
  tileScale: CONFIG.TILE_SCALE
});

// ---- Valid pixel % (cloud-free coverage) ----
var validCount = NIR.reduceRegion({
  reducer: ee.Reducer.count(), geometry: field,
  scale: CONFIG.ANALYSIS_SCALE_METERS, maxPixels: CONFIG.MAX_PIXELS, tileScale: CONFIG.TILE_SCALE
}).get('NIR');
var totalCount = ee.Image(1).reduceRegion({
  reducer: ee.Reducer.count(), geometry: field,
  scale: CONFIG.ANALYSIS_SCALE_METERS, maxPixels: CONFIG.MAX_PIXELS, tileScale: CONFIG.TILE_SCALE
}).get('constant');

// ============================================================
// BUILD REPORT + EXPORT SINGLE CSV
// ============================================================
fullStats.evaluate(function(stats) {
  stressPercentStats.evaluate(function(stressStats) {
    ee.Dictionary({valid: validCount, total: totalCount}).evaluate(function(coverage) {
      imageDate.evaluate(function(actualImageDateStr) {
        tierUsed.evaluate(function(sensorName) {
          hasNDRE.evaluate(function(ndreAvailable) {
            ee.Number(ee.Algorithms.If(usedFallback, 1, 0)).evaluate(function(fellBackNum) {
              var fellBack = fellBackNum === 1;

              var indexResults = [];
              var stressCount = 0;

              for (var i = 0; i < indexNamesList.length; i++) {
                var n = indexNamesList[i];
                var info = CONFIG.INDEX_INFO[n] || { fullName: n, healthyMsg: '', stressedMsg: '' };

                if (n === 'NDRE' && !ndreAvailable) {
                  indexResults.push({
                    name: n, fullName: info.fullName, mean: null, min: null, max: null, stdDev: null,
                    percentStressed: null, threshold: thresholdMap[n], stressed: false,
                    explanation: 'Not available this week — current sensor (' + sensorName + ') has no Red Edge band.'
                  });
                  continue;
                }

                var meanVal     = Math.round(stats[n + '_mean'] * 1000) / 1000;
                var minVal      = Math.round(stats[n + '_min'] * 1000) / 1000;
                var maxVal      = Math.round(stats[n + '_max'] * 1000) / 1000;
                var stdVal      = Math.round(stats[n + '_stdDev'] * 1000) / 1000;
                var pctStressed = Math.round(stressStats[n + '_stressed'] * 1000) / 10;

                var stressed = meanVal < thresholdMap[n];
                if (stressed) stressCount++;

                indexResults.push({
                  name: n, fullName: info.fullName,
                  mean: meanVal, min: minVal, max: maxVal, stdDev: stdVal,
                  percentStressed: pctStressed,
                  threshold: thresholdMap[n], stressed: stressed,
                  explanation: stressed ? info.stressedMsg : info.healthyMsg
                });
              }

              var overallStatus = stressCount <= CONFIG.STATUS_RULES.HEALTHY_MAX_STRESSED ? 'HEALTHY'
                : (stressCount <= CONFIG.STATUS_RULES.WARNING_MAX_STRESSED ? 'WARNING' : 'CRITICAL');

              var coveragePct = coverage.total > 0 ? Math.round((coverage.valid / coverage.total) * 100) : 0;

              print('====== CROP HEALTH REPORT ======');
              print('Sensor used: ' + sensorName + (fellBack ? '  (' + CONFIG.FALLBACK_WINDOW_DAYS + '-day window — Pass 1 fully failed)' : '  (' + CONFIG.PRIMARY_WINDOW_DAYS + '-day window — Pass 1)'));
              print('Image date: ' + actualImageDateStr);
              print('Field cloud-free coverage: ' + coveragePct + '%');
              print('Status: ' + overallStatus + '  |  Stressed: ' + stressCount + '/' + indexNamesList.length);
              for (var j = 0; j < indexResults.length; j++) {
                var r = indexResults[j];
                if (r.mean === null) {
                  print(r.name + ': N/A — ' + r.explanation);
                } else {
                  print(r.name + ': mean=' + r.mean + ' min=' + r.min + ' max=' + r.max +
                    ' std=' + r.stdDev + ' stressed-area=' + r.percentStressed + '%' +
                    (r.stressed ? ' ⚠ STRESSED' : ' ✓'));
                }
              }

              var summaryObject = {
                sensorUsed: sensorName,
                imageDate: actualImageDateStr,
                reportDate: actualImageDateStr,
                usedFallbackWindow: fellBack,
                fieldCoveragePercent: coveragePct,
                overallStatus: overallStatus,
                stressedCount: stressCount,
                indices: indexResults
              };

              var summaryFeature = ee.Feature(null, {json: JSON.stringify(summaryObject)});
              Export.table.toDrive({
                collection: ee.FeatureCollection([summaryFeature]),
                description: 'CropHealth_Summary',
                folder: CONFIG.OUTPUT_FOLDER,
                fileNamePrefix: CONFIG.OUTPUT_FILENAME,
                fileFormat: CONFIG.OUTPUT_FORMAT
              });

              print('summary.csv export task created — open Tasks panel and click RUN.');
            });
          });
        });
      });
    });
  });
});

// ============================================================
// DIAGNOSTICS
// ============================================================
function runDiagnostics() {
  print('--- Satellite chain availability (Pass 1: ' + CONFIG.PRIMARY_WINDOW_DAYS + '-day) ---');
  for (var d1 = 0; d1 < CONFIG.SENSOR_PRIORITY.length; d1++) {
    var dk1 = CONFIG.SENSOR_PRIORITY[d1];
    (function(label, countObj) {
      countObj.evaluate(function(c) { print(label + ':', c); });
    })(dk1, count1[dk1]);
  }

  allFailedPass1.evaluate(function(failed) {
    if (failed) {
      print('--- All sensors failed Pass 1 — checking Pass 2 (' + CONFIG.FALLBACK_WINDOW_DAYS + '-day) ---');
      for (var d2 = 0; d2 < CONFIG.SENSOR_PRIORITY.length; d2++) {
        var dk2 = CONFIG.SENSOR_PRIORITY[d2];
        (function(label, countObj) {
          countObj.evaluate(function(c) { print(label + ':', c); });
        })(dk2, count2[dk2]);
      }
    }
  });

  tierUsed.evaluate(function(s) {
    ee.Number(ee.Algorithms.If(usedFallback, 1, 0)).evaluate(function(fb) {
      print('>>> SENSOR USED THIS RUN:', s, fb === 1 ? '(via ' + CONFIG.FALLBACK_WINDOW_DAYS + '-day Pass 2)' : '(via ' + CONFIG.PRIMARY_WINDOW_DAYS + '-day Pass 1)');
      if (s === 'MODIS') {
        print('⚠ Using MODIS (250m) — resolution far coarser than Sentinel-2/Landsat. Treat values as rough/indicative only.');
      }
      if (s === 'NONE') {
        print('❌ No usable image found on ANY satellite even in the ' + CONFIG.FALLBACK_WINDOW_DAYS + '-day window.');
      }
    });
  });

  field.area().evaluate(function(areaSqM) {
    var ha = areaSqM / 10000;
    if (ha < CONFIG.MIN_FIELD_HA) {
      print('⚠ Field area (' + ha.toFixed(2) + ' ha) looks too small — check coordinates.');
    } else if (ha > CONFIG.MAX_FIELD_HA) {
      print('⚠ Field area (' + ha.toFixed(2) + ' ha) looks too large — check coordinates or raise tileScale.');
    }
  });
}

runDiagnostics();