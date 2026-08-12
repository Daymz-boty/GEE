// ============================================================================
// OBJECTIVE: CROPLAND DELINEATION & BIOMASS FEEDSTOCK ESTIMATION
// STUDY AREA: NIGERIA
// PLATFORM: GOOGLE EARTH ENGINE
// VERSION: 3.0 (STABLE, OPTIMIZED, FOREST-SAFE)
// ============================================================================


// ==========================
// 1. USER PARAMETERS
// ==========================

var year        = 2025;
var scale       = 500;     // meters (safe for national scale)
var maxPixels   = 1e10;
var nClusters   = 6;
var cloudThresh = 50;

// Expanded NDVI thresholds (Nigeria-wide cropland)
var minNDVI     = 0.25;   // include low-biomass & sparse crops
var highNDVI    = 0.40;   // active crop confidence
var maxNDVIcap  = 0.78;   // forest suppression (keep strict)
var minAmp      = 0.10;   // rain-fed phenological signal


var maskingStrategy = 'MODERATE';  // STRICT_AND | MODERATE | PERMISSIVE

// ==========================
// 2. STUDY AREA (SOUTHWEST NIGERIA)
// ==========================

// Load Nigeria administrative level 1 (states)
var states = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'Nigeria'));

// Define Southwest states
var southwestStates = [
  'Lagos',
  'Ogun',
  'Oyo',
  'Osun',
  'Ondo',
  'Ekiti'
];

// Filter to Southwest
var studyArea = states.filter(ee.Filter.inList('ADM1_NAME', southwestStates));

// Geometry
var geom = studyArea.geometry();

// Center map
Map.centerObject(studyArea, 7);

// Visual
Map.addLayer(studyArea, {color: 'red'}, 'Southwest Nigeria');


// ==========================
// 3. SENTINEL-2 COLLECTION
// ==========================

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(geom)
  .filterDate(year + '-01-01', year + '-12-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudThresh))
  .select(['B4', 'B8', 'QA60']);


// ==========================
// 4. CLOUD MASK + NDVI
// ==========================

function prepS2(img) {
  var qa = img.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0)
    .and(qa.bitwiseAnd(1 << 11).eq(0));

  var ndvi = img.updateMask(mask)
    .select(['B8', 'B4'])
    .multiply(0.0001)
    .normalizedDifference(['B8', 'B4'])
    .rename('NDVI');

  return ndvi.copyProperties(img, ['system:time_start']);
}


// ==========================
// 5. BIMONTHLY NDVI STACK
// ==========================

var periods = [
  ['01-01','02-28'], ['03-01','04-30'],
  ['05-01','06-30'], ['07-01','08-31'],
  ['09-01','10-31'], ['11-01','12-31']
];

var ndviBiMonthly = ee.ImageCollection(
  periods.map(function(p) {
    return s2
      .filterDate(year + '-' + p[0], year + '-' + p[1])
      .map(prepS2)
      .median();
  })
);

var ndviStack = ndviBiMonthly.toBands()
  .rename([
    'NDVI_JF','NDVI_MA','NDVI_MJ',
    'NDVI_JA','NDVI_SO','NDVI_ND'
  ])
  .clip(geom)
  .toFloat();


// ==========================
// 6. SEASONAL NDVI (CROP WINDOW)
// ==========================

var growingNDVI = s2
  .filterDate(year + '-05-01', year + '-10-31')
  .map(prepS2)
  .median()
  .clip(geom);


// ==========================
// 7. PHENOLOGY (NDVI AMPLITUDE)
// ==========================

var ndviAmp = ndviBiMonthly
  .max()
  .subtract(ndviBiMonthly.min())
  .rename('NDVI_amp');
// 8. BASE VEGETATION MASK
var vegMask = growingNDVI
  .gt(minNDVI)
  .and(growingNDVI.lt(maxNDVIcap))
  .and(ndviAmp.gt(minAmp));

// 9. CROPLAND REFERENCE DATA

// NABIL Africa cropland
var nabil = ee.Image(
  'projects/sat-io/open-datasets/landcover/AF_Cropland_mask_30m_2016_v3'
)
.select('b1').eq(1).clip(geom);

// DEA Africa cropland
var dea = ee.ImageCollection(
  'projects/sat-io/open-datasets/DEAF/CROPLAND-EXTENT/mask'
).mosaic().select('b1').eq(1).clip(geom);



// 10. ENSEMBLE CROPLAND MASK


var bothAgree   = nabil.and(dea);
var nabilHigh   = nabil.and(growingNDVI.gt(highNDVI));
var deaHigh     = dea.and(growingNDVI.gt(highNDVI));

var croplandMask;

if (maskingStrategy === 'STRICT_AND') {
  croplandMask = bothAgree;

} else if (maskingStrategy === 'PERMISSIVE') {
  croplandMask = nabil.or(dea);

} else {
  croplandMask = bothAgree
    .or(nabilHigh)
    .or(deaHigh);
}

// FINAL SAFETY FILTERS
croplandMask = croplandMask
  .and(vegMask)
  .rename('cropland')
  .toByte();
// 11. APPLY MASK TO NDVI STACK
var ndviMasked = ndviStack.updateMask(croplandMask);
// 12. UNSUPERVISED CLUSTERING

var training = ndviMasked.sample({
  region: geom,
  scale: scale,
  numPixels: 4000,
  seed: 42,
  geometries: false
});

var clusterer = ee.Clusterer.wekaKMeans(nClusters).train(training);

var clusters = ndviMasked
  .cluster(clusterer)
  .rename('cluster')
  .toByte();

// ==========================
// 13. BIMONTHLY NDVI TIME SERIES BY CLUSTER
// ==========================

print('Extracting bimonthly NDVI time series per cluster...');

var seasons = [
  {band: 'NDVI_JF', label: 'Jan-Feb'},
  {band: 'NDVI_MA', label: 'Mar-Apr'},
  {band: 'NDVI_MJ', label: 'May-Jun'},
  {band: 'NDVI_JA', label: 'Jul-Aug'},
  {band: 'NDVI_SO', label: 'Sep-Oct'},
  {band: 'NDVI_ND', label: 'Nov-Dec'}
];

var ndviTimeSeries = ee.FeatureCollection(
  seasons.map(function(s) {

    var stats = ndviMasked
      .select(s.band)
      .addBands(clusters)
      .reduceRegion({
        reducer: ee.Reducer.mean()
          .combine({
            reducer2: ee.Reducer.stdDev(),
            sharedInputs: true
          })
          .group({
            groupField: 1,
            groupName: 'cluster'
          }),
        geometry: geom,
        scale: scale,
        maxPixels: maxPixels,
        bestEffort: true,
        tileScale: 8
      });

    var groups = ee.List(stats.get('groups'));

    return ee.FeatureCollection(
      groups.map(function(g) {
        g = ee.Dictionary(g);
        return ee.Feature(null, {
          year: year,
          season: s.label,
          cluster: ee.Number(g.get('cluster')).int(),
          mean_ndvi: g.get('mean'),
          stddev_ndvi: g.get('stdDev')
        });
      })
    );
  })
).flatten();

print('NDVI time series sample:');
print(ndviTimeSeries.limit(10));


// ==========================
// 13. CLUSTER AREA CALCULATION
// ==========================

var areaImg = ee.Image.pixelArea()
  .divide(10000)
  .updateMask(clusters)
  .addBands(clusters);

var clusterArea = areaImg.reduceRegion({
  reducer: ee.Reducer.sum().group({
    groupField: 1,
    groupName: 'cluster'
  }),
  geometry: geom,
  scale: scale,
  maxPixels: maxPixels,
  tileScale: 8
});

var areaTable = ee.FeatureCollection(
  ee.List(clusterArea.get('groups')).map(function(d) {
    d = ee.Dictionary(d);
    return ee.Feature(null, {
      cluster: d.get('cluster'),
      area_ha: d.get('sum'),
      year: year
    });
  })
);

// ==========================
// 14. PRINT CLUSTER AREAS TO CONSOLE
// ==========================

print('Cluster Areas (hectares):');
print(areaTable);

// Or for a more formatted view:
var areaList = areaTable.aggregate_array('area_ha');
var clusterList = areaTable.aggregate_array('cluster');

print('Cluster IDs:', clusterList);
print('Areas (ha):', areaList);

// ==========================
// 14. VISUALS
// ==========================

Map.addLayer(croplandMask.selfMask(),
  {palette: ['green']},
  'Final Cropland Mask',
  true
);

Map.addLayer(clusters.randomVisualizer(),
  {},
  'Crop Clusters',
  false
);


// ==========================
// 15. EXPORTS
// ==========================

Export.image.toDrive({
  image: clusters,
  description: 'SW_Nigeria_CropClusters_' + year,
  folder: 'GEE_SW_Biomass',
  scale: scale,
  region: geom,
  maxPixels: maxPixels
});

Export.image.toDrive({
  image: croplandMask,
  description: 'SW_CroplandMask_' + year,
  folder: 'GEE_SW_Biomass',
  scale: scale,
  region: geom,
  maxPixels: maxPixels
});

Export.table.toDrive({
  collection: areaTable,
  description: 'SW_ClusterArea_' + year,
  folder: 'GEE_SW_Biomass',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: ndviTimeSeries,
  description: 'SW_NDVI_Bimonthly_ByCluster_' + year,
  folder: 'GEE_SW_Biomass',
  fileFormat: 'CSV'
});

