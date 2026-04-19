// ---------------------------
// 1. Define Study Area (SMALLER TEST REGION FIRST)
// ---------------------------
var statesList = ['Borno', 'Yobe', 'Jigawa', 'Kano', 'Katsina', 'Zamfara', 'Sokoto', 'Kebbi', 'Bauchi', 'Gombe'];
var nigeria = ee.FeatureCollection("FAO/GAUL/2015/level1")
               .filter(ee.Filter.eq('ADM0_NAME', 'Nigeria'))
               .filter(ee.Filter.inList('ADM1_NAME', statesList));

// OPTION 1: Test with smaller area first
var testState = nigeria.filter(ee.Filter.eq('ADM1_NAME', 'Kano')); // Single state for testing
var studyArea = testState.geometry(); // Use single state first

// OPTION 2: Use full area (comment out above lines and uncomment below)
// var studyArea = nigeria.geometry();

Map.setCenter(8.5, 12.0, 7); // Centered on Kano
Map.addLayer(studyArea, {color: 'blue', opacity: 0.3}, "Test Area - Kano State");

// ---------------------------
// 2. Create Simple Training Data (NO EXTERNAL ASSETS)
// ---------------------------
// Instead of loading external assets, create simple geometries
// This eliminates potential issues with your asset collections

// Create training polygons manually
var agricSample = ee.Geometry.Rectangle([8.0, 11.5, 8.5, 12.0]); // Agricultural area
var waterSample = ee.Geometry.Rectangle([8.6, 11.8, 8.8, 12.0]); // Water area  
var builtSample = ee.Geometry.Rectangle([8.45, 11.95, 8.55, 12.05]); // Urban area (Kano city)
var forestSample = ee.Geometry.Rectangle([7.8, 11.3, 8.2, 11.7]); // Forest area
var desertSample = ee.Geometry.Rectangle([8.8, 12.2, 9.2, 12.6]); // Desert area

// Create feature collections with class labels
var agric = ee.FeatureCollection([ee.Feature(agricSample).set('landcover', 0)]);
var water = ee.FeatureCollection([ee.Feature(waterSample).set('landcover', 1)]);
var built = ee.FeatureCollection([ee.Feature(builtSample).set('landcover', 2)]);
var forest = ee.FeatureCollection([ee.Feature(forestSample).set('landcover', 3)]);
var desert = ee.FeatureCollection([ee.Feature(desertSample).set('landcover', 4)]);

var trainingFC = agric.merge(water).merge(built).merge(forest).merge(desert);

// Visualize training areas
Map.addLayer(agric, {color: 'yellow'}, 'Agriculture Training');
Map.addLayer(water, {color: 'blue'}, 'Water Training');
Map.addLayer(built, {color: 'red'}, 'Built-up Training');
Map.addLayer(forest, {color: 'green'}, 'Forest Training');
Map.addLayer(desert, {color: 'orange'}, 'Desert Training');

// ---------------------------
// 3. Ultra-Simple Image Processing
// ---------------------------
function getSimpleImage(year) {
  var sensor = (year < 2012) ? "LANDSAT/LT05/C02/T1_L2" : "LANDSAT/LC08/C02/T1_L2";
  
  // Use only 3 essential bands
  var bands = ['SR_B4', 'SR_B3', 'SR_B2']; // NIR, Red, Green
  var outputBands = ['NIR', 'RED', 'GREEN'];

  var start = ee.Date.fromYMD(year, 6, 1); // Dry season only
  var end = ee.Date.fromYMD(year, 8, 31);

  var image = ee.ImageCollection(sensor)
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', 10)) // Very strict cloud filter
    .select(bands, outputBands)
    .map(function(img) {
      // Simple scaling without complex masking
      return img.multiply(0.0000275).add(-0.2);
    })
    .median()
    .clip(studyArea);

  return image;
}

// ---------------------------
// 4. Minimal Classifier Training
// ---------------------------
var testYear = 2020; // Use 2020 for testing
var trainingImage = getSimpleImage(testYear);

// Very basic sampling
var training = trainingImage.sampleRegions({
  collection: trainingFC,
  properties: ['landcover'],
  scale: 300, // Very coarse resolution
  tileScale: 1
});

print('Training samples:', training.size());

// Minimal classifier
var classifier = ee.Classifier.smileCart().train({ // Decision tree instead of random forest
  features: training,
  classProperty: 'landcover',
  inputProperties: ['NIR', 'RED', 'GREEN']
});

// ---------------------------
// 5. Simple Classification and Display
// ---------------------------
var classified = trainingImage.classify(classifier);

var palette = ['#ffff00', '#0000ff', '#ff0000', '#008000', '#f4a460']; 
// yellow=agric, blue=water, red=built, green=forest, orange=desert

// Direct display without resolution reduction
Map.addLayer(classified, {min: 0, max: 4, palette: palette}, 'LULC Classification');

// ---------------------------
// 6. Simple Area Calculation
// ---------------------------
// Calculate areas for each class
var pixelArea = ee.Image.pixelArea();

for (var i = 0; i < 5; i++) {
  var classMask = classified.eq(i);
  var classArea = classMask.multiply(pixelArea)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: studyArea,
      scale: 300,
      maxPixels: 1e8
    });
  
  var className = ['Agriculture', 'Water', 'Built-up', 'Forest', 'Desert'][i];
  print(className + ' area (sq.m):', classArea.get('classification'));
}

// ---------------------------
// 7. Export Function (Simplified)
// ---------------------------
function exportSimpleClassification() {
  Export.image.toDrive({
    image: classified,
    description: 'Simple_LULC_' + testYear,
    folder: 'LULC_Test',
    scale: 300,
    region: studyArea,
    maxPixels: 1e10,
    crs: 'EPSG:4326'
  });
}

// Uncomment to export after successful run
// exportSimpleClassification();

print('Simple classification completed for', testYear);
print('If this works, you can modify for other years and full study area');