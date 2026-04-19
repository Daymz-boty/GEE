// ==========================
// PREPARE ENVIRONMENT
// ==========================

// Nigeria bounday
var nigeria = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
                .filter(ee.Filter.eq('country_na', 'Nigeria'));

// Center map on Nigeria
Map.centerObject(nigeria, 6);

// Projection: UTM Zone 31N
var utmProj = ee.Projection('EPSG:32631');
var scale = 506.49548;  // same as biomass raster

// Visualization parameters
var distanceVis = {min: 0, max: 10000, palette: ['blue', 'yellow', 'red']};
var slopeVis = {min: 0, max: 30, palette: ['green', 'yellow', 'red']};
var maskVis = {min: 0, max: 1, palette: ['white', 'red']};

// ==========================
// 1) POWER GRID PROXIMITY
// ==========================
print('Processing: Power Grid Distance...');

// Use power plants as proxy for grid infrastructure
var powerPlants = ee.FeatureCollection("WRI/GPPD/power_plants")
                  .filterBounds(nigeria);

// Create a raster from power plant points
var powerLinesRaster = powerPlants
  .reduceToImage(['capacitymw'], ee.Reducer.first())
  .clip(nigeria)
  .gt(0)
  .selfMask()
  .unmask(0);

var powerDist = powerLinesRaster
  .distance(ee.Kernel.euclidean(50000, 'meters'))  // Increased to 50km for better coverage
  .reproject({crs: utmProj, scale: scale})
  .clip(nigeria)
  .rename('power_distance');

// Add to map
Map.addLayer(powerDist, distanceVis, 'Power Grid Distance (m)', false);

// Export
Export.image.toDrive({
  image: powerDist,
  description: 'power_grid_distance',
  folder: 'biomass_MCA',
  fileNamePrefix: 'power_grid_distance',
  region: nigeria.geometry(),
  crs: 'EPSG:32631',
  scale: scale,
  maxPixels: 1e13
});

print('✓ Power Grid Distance layer ready (based on power plants)');

// ==========================
// 2) WATER PROXIMITY
// ==========================
print('Processing: Water Distance...');

var gsw = ee.Image("JRC/GSW1_4/GlobalSurfaceWater");
var waterMask = gsw.select('occurrence')
  .gt(50) // Areas with >50% water occurrence
  .clip(nigeria)
  .selfMask()
  .unmask(0);

var waterDist = waterMask
  .distance(ee.Kernel.euclidean(10000, 'meters'))
  .reproject({crs: utmProj, scale: scale})
  .clip(nigeria)
  .rename('water_distance');

// Add to map
Map.addLayer(waterDist, distanceVis, 'Water Distance (m)', false);

// Export
Export.image.toDrive({
  image: waterDist,
  description: 'water_distance',
  folder: 'biomass_MCA',
  fileNamePrefix: 'water_distance',
  region: nigeria.geometry(),
  crs: 'EPSG:32631',
  scale: scale,
  maxPixels: 1e13
});

print('✓ Water Distance layer ready');

// ==========================
// 3) SLOPE FROM DEM
// ==========================
print('Processing: Slope...');

var dem = ee.Image('USGS/SRTMGL1_003').clip(nigeria);
var slope = ee.Terrain.slope(dem)
  .reproject({crs: utmProj, scale: scale})
  .clip(nigeria)
  .rename('slope_degrees');

// Add to map
Map.addLayer(slope, slopeVis, 'Slope (degrees)', false);

// Export
Export.image.toDrive({
  image: slope,
  description: 'slope_2025',
  folder: 'biomass_MCA',
  fileNamePrefix: 'slope_2025',
  region: nigeria.geometry(),
  crs: 'EPSG:32631',
  scale: scale,
  maxPixels: 1e13
});

print('✓ Slope layer ready');

// ==========================
// 4) URBAN SETTLEMENTS MASK
// ==========================
print('Processing: Urban Settlements Mask...');

var ghsl = ee.ImageCollection("JRC/GHSL/P2023A/GHS_BUILT_S")
            .filterBounds(nigeria)
            .first()
            .select('built_surface')
            .clip(nigeria);

var urbanBinary = ghsl.gt(0)
  .selfMask()
  .unmask(0)
  .rename('urban_mask');

// Add to map
Map.addLayer(urbanBinary.selfMask(), maskVis, 'Urban Areas', false);

// Export
Export.image.toDrive({
  image: urbanBinary,
  description: 'urban_mask',
  folder: 'biomass_MCA',
  fileNamePrefix: 'urban_mask',
  region: nigeria.geometry(),
  crs: 'EPSG:32631',
  scale: scale,
  maxPixels: 1e13
});

print('✓ Urban Settlements Mask ready');

// ==========================
// 5) PROTECTED AREAS MASK
// ==========================
print('Processing: Protected Areas Mask...');

var wdpa = ee.FeatureCollection("WCMC/WDPA/current/polygons")
            .filterBounds(nigeria);

var paRaster = wdpa
  .filterBounds(nigeria)
  .map(function(feat) {
    return feat.set('constant', 1);
  })
  .reduceToImage(['constant'], ee.Reducer.first())
  .clip(nigeria)
  .unmask(0)
  .rename('protected_areas');

// Add to map
Map.addLayer(paRaster.selfMask(), maskVis, 'Protected Areas', false);

// Export
Export.image.toDrive({
  image: paRaster,
  description: 'protected_areas_mask',
  folder: 'biomass_MCA',
  fileNamePrefix: 'protected_areas_mask',
  region: nigeria.geometry(),
  crs: 'EPSG:32631',
  scale: scale,
  maxPixels: 1e13
});

print('✓ Protected Areas Mask ready');

// ==========================
// COMPLETION MESSAGE
// ==========================
print('═══════════════════════════════════════════════');
print('✓✓✓ ALL 5 MCA RASTERS GENERATED SUCCESSFULLY ✓✓✓');
print('═══════════════════════════════════════════════');
print('Layers available in the map (toggle on to view):');
print('  1. Power Grid Distance (from power plants)');
print('  2. Water Distance');
print('  3. Slope (degrees)');
print('  4. Urban Areas');
print('  5. Protected Areas');
print('');
print('Export tasks queued to Google Drive folder: biomass_MCA');
print('Click "Tasks" tab to run exports →');
print('═══════════════════════════════════════════════');

// Add Nigeria boundary for reference
Map.addLayer(nigeria, {color: 'black'}, 'Nigeria Boundary', true, 0.5);