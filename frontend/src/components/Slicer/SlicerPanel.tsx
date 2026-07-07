import React, { useState, useEffect } from 'react';
import { SliceSettings } from '@services/slicer/types';

interface SlicerPanelProps {
    onSlice: (settings: SliceSettings) => void;
    isSlicing: boolean;
    progress: number;
    statusMessage: string;
}

const STORAGE_KEY = 'mazicalign_slicer_settings';

const SlicerPanel: React.FC<SlicerPanelProps> = ({
    onSlice,
    isSlicing,
    progress,
    statusMessage,
}) => {
    const [activeTab, setActiveTab] = useState<'common' | 'fdm' | 'dlp'>('common');
    const [settings, setSettings] = useState<SliceSettings>({
        // Common
        layerHeight: 0.05,
        buildWidth: 192,
        buildDepth: 120,
        buildHeight: 200,

        // FDM
        fdmSpeed: 60,
        fdmExtrusionRate: 1.0,
        nozzleDiameter: 0.4,
        wallCount: 2,
        infillPercentage: 100,
        infillPattern: 'lines',
        infillOverlapPercentage: 15,
        wallOverlapPercentage: 0,
        outerWallOverlapPercentage: 0,
        wallPrintOrder: 'inner-to-outer',
        printOrder: 'walls-first',
        enableGapFilling: true,

        // FDM - Temperature
        nozzleTemp: 200,
        bedTemp: 60,

        // FDM - Retraction
        enableRetraction: true,
        retractLength: 5.0,
        retractSpeed: 40,
        retractZHop: 0.2,
        retractMinTravelDistance: 1.0,

        // FDM - Fan
        fanSpeed: 100,
        fanDisableLayerCount: 2,

        // DLP - Display
        resolutionX: 3840,
        resolutionY: 2400,
        pixelSize: 50,

        // DLP - Exposure
        lightPower: 80,
        exposureTime: 2.5,
        bottomExposureTime: 30,
        bottomLayerCount: 6,
        transitionLayerCount: 6,
        lightOffDelay: 1.0,

        // DLP - Z Movement
        liftDistance: 6.0,
        liftSpeed: 3.0,
        zLiftSpeed: 3.0,
        dlpRetractSpeed: 3.0,
    });

    // Load settings from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setSettings(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error("Failed to load settings", e);
            }
        }
    }, []);

    // Auto-calculate pixel size when resolution or build width changes
    useEffect(() => {
        if (settings.buildWidth > 0 && settings.resolutionX > 0) {
            const calculatedPixelSize = (settings.buildWidth / settings.resolutionX) * 1000;
            if (Math.abs(calculatedPixelSize - settings.pixelSize) > 0.01) {
                setSettings(prev => ({ ...prev, pixelSize: parseFloat(calculatedPixelSize.toFixed(2)) }));
            }
        }
    }, [settings.buildWidth, settings.resolutionX]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const isCheckbox = type === 'checkbox';
        const stringFields = ['wallPrintOrder', 'infillPattern', 'printOrder'];
        const isNumber = type === 'number' || (!stringFields.includes(name) && !isCheckbox);

        setSettings((prev) => {
            const newSettings = {
                ...prev,
                [name]: isCheckbox ? (e.target as HTMLInputElement).checked : (isNumber ? parseFloat(value) : value),
            };
            return newSettings;
        });
    };

    const handleSliceClick = () => {
        // Save settings to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        onSlice(settings);
    };

    // Profile Management
    const [profiles, setProfiles] = useState<{ [name: string]: SliceSettings }>({});
    const [currentProfileName, setCurrentProfileName] = useState<string>('Default');

    useEffect(() => {
        const savedProfiles = localStorage.getItem('mazicalign_slicer_profiles');
        if (savedProfiles) {
            try {
                setProfiles(JSON.parse(savedProfiles));
            } catch (e) {
                console.error("Failed to load profiles", e);
            }
        } else {
            // Initialize with default
            setProfiles({ 'Default': settings });
        }
    }, []);

    const saveProfilesToStorage = (newProfiles: { [name: string]: SliceSettings }) => {
        localStorage.setItem('mazicalign_slicer_profiles', JSON.stringify(newProfiles));
        setProfiles(newProfiles);
    };

    const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const name = e.target.value;
        if (profiles[name]) {
            setSettings(profiles[name]);
            setCurrentProfileName(name);
        }
    };

    const handleSaveProfile = () => {
        if (currentProfileName === 'Default') {
            handleSaveAsProfile();
            return;
        }
        const newProfiles = { ...profiles, [currentProfileName]: settings };
        saveProfilesToStorage(newProfiles);
        alert(`Profile '${currentProfileName}' saved.`);
    };

    const handleSaveAsProfile = () => {
        const name = prompt("Enter profile name:", "Custom Profile");
        if (name) {
            const newProfiles = { ...profiles, [name]: settings };
            saveProfilesToStorage(newProfiles);
            setCurrentProfileName(name);
        }
    };

    const handleDeleteProfile = () => {
        if (currentProfileName === 'Default') {
            alert("Cannot delete Default profile.");
            return;
        }
        if (confirm(`Delete profile '${currentProfileName}'?`)) {
            const newProfiles = { ...profiles };
            delete newProfiles[currentProfileName];
            saveProfilesToStorage(newProfiles);
            setCurrentProfileName('Default');
            setSettings(newProfiles['Default'] || settings);
        }
    };

    const handleExportProfile = () => {
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProfileName.replace(/\s+/g, '_')}_profile.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportProfile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target?.result as string);
                setSettings(prev => ({ ...prev, ...parsed }));
                // Optionally ask to save as new profile?
                // For now just load into current view
            } catch (err) {
                alert('Failed to parse profile file');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const tabs = [
        { id: 'common', label: 'Common' },
        { id: 'fdm', label: 'Material' },
        { id: 'dlp', label: 'DLP' },
    ] as const;

    const SettingRow = ({ label, name, value, step = 1, min, max, readOnly = false, title }: any) => (
        <div className="flex justify-between items-center py-1">
            <label className="text-sm text-gray-400">{label}</label>
            <input
                type="number"
                name={name}
                value={value}
                onChange={readOnly ? undefined : handleChange}
                step={step}
                min={min}
                max={max}
                readOnly={readOnly}
                title={title}
                className={`bg-gray-700 text-white px-2 py-1 rounded w-24 text-right focus:outline-none focus:border-green-500 ${readOnly ? 'cursor-not-allowed text-gray-500' : ''}`}
            />
        </div>
    );

    return (
        <div className="bg-gray-800 text-white p-4 rounded-lg h-full flex flex-col">
            <h3 className="text-lg font-semibold mb-4">Slice Settings</h3>

            {/* Profile Manager */}
            <div className="mb-4 p-2 bg-gray-700 rounded space-y-2">
                <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-300">Profile</span>
                    <select
                        value={currentProfileName}
                        onChange={handleProfileChange}
                        className="bg-gray-600 text-white text-sm px-2 py-1 rounded w-32 focus:outline-none"
                    >
                        {Object.keys(profiles).map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex space-x-1">
                    <button onClick={handleSaveProfile} className="flex-1 bg-blue-600 hover:bg-blue-500 text-xs py-1 rounded">Save</button>
                    <button onClick={handleSaveAsProfile} className="flex-1 bg-blue-600 hover:bg-blue-500 text-xs py-1 rounded">Save As</button>
                    <button onClick={handleDeleteProfile} className="flex-1 bg-red-600 hover:bg-red-500 text-xs py-1 rounded">Del</button>
                </div>
                <div className="flex space-x-1 pt-1 border-t border-gray-600">
                    <button onClick={handleExportProfile} className="flex-1 bg-gray-500 hover:bg-gray-400 text-xs py-1 rounded">Export</button>
                    <button onClick={() => document.getElementById('import-profile')?.click()} className="flex-1 bg-gray-500 hover:bg-gray-400 text-xs py-1 rounded">Import</button>
                    <input type="file" id="import-profile" accept=".json" className="hidden" onChange={handleImportProfile} />
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-700 mb-4">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 py-2 text-sm font-medium transition-colors ${activeTab === tab.id
                            ? 'text-green-500 border-b-2 border-green-500'
                            : 'text-gray-400 hover:text-gray-300'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Settings Content */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {activeTab === 'common' && (
                    <>
                        <SettingRow label="Layer Height (mm)" name="layerHeight" value={settings.layerHeight} step={0.01} />
                        <SettingRow label="Build Width (mm)" name="buildWidth" value={settings.buildWidth} />
                        <SettingRow label="Build Depth (mm)" name="buildDepth" value={settings.buildDepth} />
                        <SettingRow label="Build Height (mm)" name="buildHeight" value={settings.buildHeight} />
                    </>
                )}

                {activeTab === 'fdm' && (
                    <>
                        <SettingRow label="Nozzle Diameter (mm)" name="nozzleDiameter" value={settings.nozzleDiameter} step={0.1} />
                        <SettingRow label="Wall Count" name="wallCount" value={settings.wallCount} min={1} />
                        <div className="flex justify-between items-center py-1">
                            <label className="text-sm text-gray-400">Wall Print Order</label>
                            <select
                                name="wallPrintOrder"
                                value={settings.wallPrintOrder}
                                onChange={handleChange}
                                className="bg-gray-700 text-white px-2 py-1 rounded w-32 text-right focus:outline-none focus:border-green-500"
                            >
                                <option value="inner-to-outer">Inner to Outer</option>
                                <option value="outer-to-inner">Outer to Inner</option>
                            </select>
                        </div>
                        <div className="flex justify-between items-center py-1">
                            <label className="text-sm text-gray-400">Layer Print Order</label>
                            <select
                                name="printOrder"
                                value={settings.printOrder || 'walls-first'}
                                onChange={handleChange}
                                className="bg-gray-700 text-white px-2 py-1 rounded w-32 text-right focus:outline-none focus:border-green-500"
                            >
                                <option value="walls-first">Walls First</option>
                                <option value="infill-first">Infill First</option>
                            </select>
                        </div>
                        <div className="flex justify-between items-center py-1">
                            <label className="text-sm text-gray-400">Enable Gap Filling</label>
                            <input
                                type="checkbox"
                                name="enableGapFilling"
                                checked={settings.enableGapFilling}
                                onChange={handleChange}
                                className="h-4 w-4 text-green-500 focus:ring-green-500 border-gray-300 rounded"
                            />
                        </div>
                        <SettingRow label="Outer Wall Overlap (%)" name="outerWallOverlapPercentage" value={settings.outerWallOverlapPercentage || 0} />
                        <SettingRow label="Wall Overlap (%)" name="wallOverlapPercentage" value={settings.wallOverlapPercentage || 0} />
                        <SettingRow label="Infill Percentage (%)" name="infillPercentage" value={settings.infillPercentage} min={0} max={100} />
                        <div className="flex justify-between items-center py-1">
                            <label className="text-sm text-gray-400">Infill Pattern</label>
                            <select
                                name="infillPattern"
                                value={settings.infillPattern || 'lines'}
                                onChange={handleChange}
                                className="bg-gray-700 text-white px-2 py-1 rounded w-32 text-right focus:outline-none focus:border-green-500"
                            >
                                <option value="lines">Lines</option>
                                <option value="grid">Grid</option>
                                <option value="zigzag">ZigZag</option>
                            </select>
                        </div>
                        <SettingRow label="Infill Overlap (%)" name="infillOverlapPercentage" value={settings.infillOverlapPercentage || 15} />
                        <SettingRow label="Extruder Speed (mm/s)" name="fdmExtrusionRate" value={settings.fdmExtrusionRate} />
                        <SettingRow label="XY Speed (mm/s)" name="fdmSpeed" value={settings.fdmSpeed} />

                        {/* Temperature */}
                        <div className="border-t border-gray-600 mt-3 pt-3">
                            <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Temperature</span>
                        </div>
                        <SettingRow label="Nozzle Temp (°C)" name="nozzleTemp" value={settings.nozzleTemp} min={150} max={300} />
                        <SettingRow label="Bed Temp (°C)" name="bedTemp" value={settings.bedTemp} min={0} max={120} />

                        {/* Retraction */}
                        <div className="border-t border-gray-600 mt-3 pt-3">
                            <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Retraction</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                            <label className="text-sm text-gray-400">Enable Retraction</label>
                            <input
                                type="checkbox"
                                name="enableRetraction"
                                checked={settings.enableRetraction}
                                onChange={handleChange}
                                className="h-4 w-4 text-green-500 focus:ring-green-500 border-gray-300 rounded"
                            />
                        </div>
                        {settings.enableRetraction && (
                            <>
                                <SettingRow label="Retract Length (mm)" name="retractLength" value={settings.retractLength} step={0.5} min={0} max={15} />
                                <SettingRow label="Retract Speed (mm/s)" name="retractSpeed" value={settings.retractSpeed} min={10} max={100} />
                                <SettingRow label="Z Hop (mm)" name="retractZHop" value={settings.retractZHop} step={0.1} min={0} max={2} />
                                <SettingRow label="Min Travel (mm)" name="retractMinTravelDistance" value={settings.retractMinTravelDistance} step={0.5} min={0} />
                            </>
                        )}

                        {/* Fan Control */}
                        <div className="border-t border-gray-600 mt-3 pt-3">
                            <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Fan Control</span>
                        </div>
                        <SettingRow label="Fan Speed (%)" name="fanSpeed" value={settings.fanSpeed} min={0} max={100} />
                        <SettingRow label="Disable First N Layers" name="fanDisableLayerCount" value={settings.fanDisableLayerCount} min={0} max={10} />
                    </>
                )}

                {activeTab === 'dlp' && (
                    <>
                        {/* Display */}
                        <div className="mb-2">
                            <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Display</span>
                        </div>
                        <SettingRow label="Resolution X (px)" name="resolutionX" value={settings.resolutionX} />
                        <SettingRow label="Resolution Y (px)" name="resolutionY" value={settings.resolutionY} />
                        <SettingRow label="Pixel Size (µm)" name="pixelSize" value={settings.pixelSize} readOnly title="Auto-calculated from Build Width / Resolution X" />

                        {/* Exposure */}
                        <div className="border-t border-gray-600 mt-3 pt-3">
                            <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Exposure</span>
                        </div>
                        <SettingRow label="Normal Exposure (s)" name="exposureTime" value={settings.exposureTime} step={0.1} min={0.1} />
                        <SettingRow label="Bottom Exposure (s)" name="bottomExposureTime" value={settings.bottomExposureTime} step={1} min={1} />
                        <SettingRow label="Bottom Layer Count" name="bottomLayerCount" value={settings.bottomLayerCount} min={1} max={20} />
                        <SettingRow label="Transition Layers" name="transitionLayerCount" value={settings.transitionLayerCount} min={0} max={20} />
                        <SettingRow label="Light Power (%)" name="lightPower" value={settings.lightPower} min={0} max={100} />
                        <SettingRow label="Light-Off Delay (s)" name="lightOffDelay" value={settings.lightOffDelay} step={0.1} min={0} />

                        {/* Z Movement */}
                        <div className="border-t border-gray-600 mt-3 pt-3">
                            <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Z Movement</span>
                        </div>
                        <SettingRow label="Lift Distance (mm)" name="liftDistance" value={settings.liftDistance} step={0.5} min={1} max={20} />
                        <SettingRow label="Lift Speed (mm/s)" name="liftSpeed" value={settings.liftSpeed} step={0.5} min={0.5} max={10} />
                        <SettingRow label="Retract Speed (mm/s)" name="dlpRetractSpeed" value={settings.dlpRetractSpeed} step={0.5} min={0.5} max={10} />
                    </>
                )}
            </div>

            {/* Action Buttons */}
            <div className="mt-4 pt-4 border-t border-gray-700 space-y-2">
                {isSlicing ? (
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm text-gray-400">
                            <span>{statusMessage}</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2.5">
                            <div
                                className="bg-green-600 h-2.5 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={handleSliceClick}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded transition-colors"
                    >
                        Slice Model
                    </button>
                )}
            </div>
        </div>
    );
};

export default SlicerPanel;
