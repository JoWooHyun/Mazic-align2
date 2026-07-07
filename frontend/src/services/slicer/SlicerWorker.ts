import { SlicerWorkerMessage, SlicerWorkerResponse, SliceMetadata } from './types';
import { SliceEngine } from './SliceEngine';
import { GCodeGenerator } from './GCodeGenerator';
import { ImageGenerator } from './ImageGenerator';

const ctx: Worker = self as any;

ctx.addEventListener('message', async (event: MessageEvent<SlicerWorkerMessage>) => {
    const message = event.data;

    switch (message.type) {
        case 'SLICE':
            try {
                const { meshData, settings } = message.payload;

                postMessage({
                    type: 'PROGRESS',
                    payload: { progress: 0, currentLayer: 0, totalLayers: 0, message: 'Starting slice...' }
                });

                // 1. Slice Geometry
                const engine = new SliceEngine(meshData, settings);
                const layers = engine.slice();

                postMessage({
                    type: 'PROGRESS',
                    payload: { progress: 30, currentLayer: 0, totalLayers: layers.length, message: 'Geometry sliced. Generating output...' }
                });

                // 2. Generate Output (G-code & Images)
                const gcodeGen = new GCodeGenerator(settings);

                // Dynamic resolution from settings
                const pixelPerMm = 1000 / settings.pixelSize;
                const imageGen = new ImageGenerator(settings.resolutionX, settings.resolutionY, pixelPerMm);

                for (let i = 0; i < layers.length; i++) {
                    const layer = layers[i];

                    // Generate G-code
                    const { gcode, paths } = gcodeGen.generateLayer(layer, layer.z, i);
                    layer.gcode = gcode;
                    layer.paths = paths;

                    // Generate Image
                    layer.imageData = await imageGen.generateLayer(layer.polygons);

                    // Calculate exposure time for this layer
                    if (i < settings.bottomLayerCount) {
                        layer.exposureTime = settings.bottomExposureTime;
                    } else if (i < settings.bottomLayerCount + settings.transitionLayerCount) {
                        const progress = (i - settings.bottomLayerCount) / settings.transitionLayerCount;
                        layer.exposureTime = settings.bottomExposureTime +
                            (settings.exposureTime - settings.bottomExposureTime) * progress;
                    } else {
                        layer.exposureTime = settings.exposureTime;
                    }

                    // Report Progress
                    if (i % 10 === 0) {
                        const progress = 30 + (i / layers.length) * 70;
                        postMessage({
                            type: 'PROGRESS',
                            payload: {
                                progress: Math.round(progress),
                                currentLayer: i + 1,
                                totalLayers: layers.length,
                                message: `Processing layer ${i + 1}/${layers.length}`
                            }
                        });
                    }
                }

                // 3. Assemble full G-code (header + layers + footer)
                let fullGcode = gcodeGen.generateHeader();
                for (const layer of layers) {
                    fullGcode += layer.gcode;
                }
                fullGcode += gcodeGen.generateFooter();

                // 4. Calculate estimated print time
                let estimatedTime = 0;
                for (const layer of layers) {
                    estimatedTime += layer.exposureTime;
                    estimatedTime += settings.lightOffDelay;
                    estimatedTime += settings.liftDistance / settings.liftSpeed;
                    estimatedTime += settings.liftDistance / settings.dlpRetractSpeed;
                }

                // 5. Build metadata
                const metadata: SliceMetadata = {
                    totalLayers: layers.length,
                    layerHeight: settings.layerHeight,
                    buildWidth: settings.buildWidth,
                    buildDepth: settings.buildDepth,
                    buildHeight: settings.buildHeight,
                    resolutionX: settings.resolutionX,
                    resolutionY: settings.resolutionY,
                    exposureTime: settings.exposureTime,
                    bottomExposureTime: settings.bottomExposureTime,
                    bottomLayerCount: settings.bottomLayerCount,
                    estimatedTime,
                };

                postMessage({ type: 'COMPLETE', payload: { layers, fullGcode, metadata } });

            } catch (error) {
                console.error('Slicer error:', error);
                postMessage({
                    type: 'ERROR',
                    payload: error instanceof Error ? error.message : 'Unknown slicing error'
                });
            }
            break;

        case 'CANCEL':
            break;
    }
});

function postMessage(message: SlicerWorkerResponse) {
    ctx.postMessage(message);
}
