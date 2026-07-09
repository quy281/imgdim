import React from 'react';
import { Undo2, Redo2 } from 'lucide-react';

const THICKNESS_PRESETS = [110, 220];

/**
 * Small settings bar shown while the wall tool is active:
 * wall thickness presets, ortho toggle, grid-snap toggle, undo/redo (touch devices have no Ctrl+Z).
 */
const PlanSettingsBar = ({ settings, onChange, onUndo, onRedo, canUndo, canRedo }) => {
    const set = (k, v) => onChange({ ...settings, [k]: v });
    const isCustom = !THICKNESS_PRESETS.includes(settings.wallThickness);
    return (
        <div className="plan-settings-bar">
            <span className="psb-label">Tường</span>
            {THICKNESS_PRESETS.map(t => (
                <button key={t} className={`psb-btn ${settings.wallThickness === t ? 'active' : ''}`}
                    onClick={() => set('wallThickness', t)}>{t}</button>
            ))}
            <button className={`psb-btn ${isCustom ? 'active' : ''}`}
                onClick={() => {
                    const v = prompt('Độ dày tường (mm):', settings.wallThickness);
                    if (v === null) return;
                    const n = parseFloat(v);
                    if (!isNaN(n) && n > 0) set('wallThickness', n);
                }}>{isCustom ? settings.wallThickness : '…'}</button>
            <span className="psb-sep" />
            <button className={`psb-btn ${settings.orthoMode ? 'active' : ''}`}
                onClick={() => set('orthoMode', !settings.orthoMode)}>⊾ Vuông góc</button>
            <button className={`psb-btn ${settings.gridSnap ? 'active' : ''}`}
                onClick={() => set('gridSnap', !settings.gridSnap)}># Lưới</button>
            <span className="psb-sep" />
            <button className="psb-btn" disabled={!canUndo} onClick={onUndo} title="Hoàn tác"><Undo2 size={14} /></button>
            <button className="psb-btn" disabled={!canRedo} onClick={onRedo} title="Làm lại"><Redo2 size={14} /></button>
        </div>
    );
};

export default PlanSettingsBar;
