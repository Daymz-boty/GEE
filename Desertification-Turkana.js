// -----------------------------------------
// Turkana County Desertification Study
// Memory-Optimized Version for 2022-2024
// -----------------------------------------

print('=== TURKANA DESERTIFICATION STUDY (Memory-Optimized) ===');

// ---------------------------
// 1. SELECT YEAR TO PROCESS
// ---------------------------
var yearSet = {label: '2022-2024', start: 2022, end: 2024};
print('Processing year set:', yearSet);

// ---------------------------
// 2. DEFINE TURKANA BOUNDARY
// ---------------------------
var turkana = ee.FeatureCollection("projects/rich-discovery-456203-u0/assets/turk");
var turkanaGeometry = turkana.geometry();

// Center map on Turkana
Map.centerObject(turkana, 8);
Map.addLayer(turkanaGeometry, {color: 'blue', opacity: 0.3}, "Turkana County Boundary");

print('Study area loaded from custom asset');

// ---------------------------
// 3. TRAINING DATA (Reduced for memory efficiency)
// ---------------------------
var trainingPoints = [
  // Vegetation (0) - reduced points
  [35.3, 3.0, 0], [35.1, 3.3, 0], [34.9, 3.6, 0], [35.8, 1.6, 0], 
  [35.9, 1.4, 0], [35.7, 1.3, 0], [34.4, 4.0, 0], [34.7, 3.6, 0], 
  [35.1, 2.2, 0], [34.8, 2.8, 0],
  
  // Cropland (1) - reduced points
  [35.4, 3.0, 1], [35.3, 2.9, 1], [35.5, 3.1, 1], [35.8, 1.8, 1], 
  [35.7, 1.9, 1], [34.2, 4.2, 1],
  
  // Water (2) - reduced points
  [35.94638931150031, 4.294440786033454, 2],
  [35.94638931150031, 3.636843015701941, 2],
  [36.01230728025031, 3.636843015701941, 2],
  [35.88047134275031, 3.899944566063641, 2],
  [35.95188247556281, 4.376602456004426, 2],
  
  // Bare land (3) - reduced points
  [34.5, 4.8, 3], [34.8, 4.6, 3], [35.0, 4.5, 3], [35.3, 4.7, 3],
  [34.0, 4.0, 3], [34.2, 3.8, 3], [35.0, 3.5, 3], [35.2, 3.7, 3],
  [36.0, 4.0, 3], [36.2, 3.7, 3],
  
  // Built-up (4) - key locations only
  [35.6022943, 3.1165858, 4], // Lodwar
  [34.8572, 3.71363, 4],      // Kakuma
  [34.358792, 4.202021, 4],   // Lokichogio
  [35.858188, 3.535085, 4]    // Kalokol
];

// Convert to FeatureCollection with smaller buffers
var trainingFeatures = trainingPoints.map(function(p) {
  return ee.Feature(ee.Geometry.Point([p[0], p[1]]), {landcover: p[2]});
});
var trainingFC = ee.FeatureCollection(trainingFeatures);

// Smaller buffers to reduce memory usage
var trainingPolygons = trainingFC.map(function(f) {
  var lc = ee.Number(f.get('landcover'));
  var bufferSize = ee.Algorithms.If(lc.eq(2), 150,  // Water: reduced from 200
                      ee.Algorithms.If(lc.eq(1), 400, // Cropland: reduced from 600
                        ee.Algorithms.If(lc.eq(4), 300, 600))); // Built-up & others: reduced
  return f.buffer(bufferSize);
});

// ---------------------------
// 4. OPTIMIZED CLOUD MASK & COMPOSITE
// ---------------------------
function maskLandsatSR(image) {
  var bn = image.bandNames();
  if (bn.contains('QA_PIXEL')) {
    var qa = image.select('QA_PIXEL');
    var cloud = 1 << 3;
    var shadow = 1 << 4;
    var mask = qa.bitwiseAnd(cloud).eq(0).and(qa.bitwiseAnd(shadow).eq(0));
    return image.updateMask(mask);
  } else if (bn.contains('pixel_qa')) {
    var qa2 = image.select('pixel_qa');
    var cloud2 = 1 << 5;
    var shadow2 = 1 << 3;
    var mask2 = qa2.bitwiseAnd(cloud2).eq(0).and(qa2.bitwiseAnd(shadow2).eq(0));
    return image.updateMask(mask2);
  } else {
    return image;
  }
}

// Memory-optimized composite function
function getOptimizedComposite(startYear, endYear) {
  var start = ee.Date.fromYMD(startYear, 1, 1);
  var end = ee.Date.fromYMD(endYear, 12, 31);

  // Focus only on L8/L9 for recent years (2022-2024) to reduce data volume
  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterDate(start, end);
  var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2').filterDate(start, end);

  var merged = l8.merge(l9)
    .filterBounds(turkanaGeometry)
    .filter(ee.Filter.lt('CLOUD_COVER', 60)) // Stricter cloud filter
    .map(maskLandsatSR)
    .map(function(img) { 
      return img.multiply(0.0000275).add(-0.2).select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7']); 
    });

  // Rename bands to standard names
  var harmonized = merged.map(function(img) {
    return img.rename(['B1','B2','B3','B4','B5','B7']);
  });

  // Use percentile composite instead of median for better memory efficiency
  var comp = harmonized.reduce(ee.Reducer.percentile([50])).clip(turkanaGeometry);
  
  // Rename bands after reduction
  comp = comp.rename(['B1','B2','B3','B4','B5','B7']);
  
  var ndvi = comp.normalizedDifference(['B4','B3']).rename('NDVI');
  comp = comp.addBands(ndvi);

  return comp;
}

// ---------------------------
// 5. MEMORY-EFFICIENT CLASSIFICATION
// ---------------------------
var composite = getOptimizedComposite(yearSet.start, yearSet.end);
Map.addLayer(composite, {bands:['B4','B3','B2'], min:0, max:0.25}, 'Composite ' + yearSet.label);

var bands = ['B1','B2','B3','B4','B5','B7','NDVI'];

// Reduced Random Forest parameters for memory efficiency
var rf = ee.Classifier.smileRandomForest({
  numberOfTrees: 50,        // Reduced from 150
  variablesPerSplit: 2,     // Reduced from 3
  minLeafPopulation: 10     // Increased from 5
});

// Sample with reduced scale for memory efficiency
var training = composite.select(bands).sampleRegions({
  collection: trainingPolygons,
  properties: ['landcover'],
  scale: 60,  // Increased from 30 to reduce memory
  tileScale: 4 // Add tiling to reduce memory usage
});

var trained = rf.train(training, 'landcover', bands);
var classified = composite.select(bands).classify(trained);

var classNames = ['Vegetation', 'Cropland', 'Water', 'Bare Land', 'Built-up'];
var colors = ['#2b7a0b', '#ffdd57', '#2a8cff', '#b5651d', '#7f7f7f'];
Map.addLayer(classified, {min:0, max:4, palette:colors}, 'LULC ' + yearSet.label);

// ---------------------------
// 6. MEMORY-EFFICIENT EXPORT
// ---------------------------
Export.image.toDrive({
  image: classified,
  description: 'LULC_' + yearSet.label.replace(/ /g,'_') + '_Turkana_Optimized',
  folder: 'Turkana_Desertification_Study',
  region: turkanaGeometry,
  scale: 60,          // Increased from 30
  maxPixels: 1e9,     // Reduced from 1e10
  fileFormat: 'GeoTIFF',
  fileDimensions: 4096 // Limit file dimensions
});

print('Export task created for optimized classification');