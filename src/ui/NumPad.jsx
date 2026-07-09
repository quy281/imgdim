import React, { useState, useEffect } from 'react';
import { Delete } from 'lucide-react';
import Sheet from './Sheet';

/**
 * Numeric bottom-sheet keypad for mm input — the on-site laser-meter workflow.
 * cfg = { title, initial, hint, onOK(value) } | null
 */
export default function NumPad({ cfg, onClose }) {
    const [val, setVal] = useState('');
    useEffect(() => { setVal(''); }, [cfg]);
    if (!cfg) return null;

    const press = (d) => setVal(v => (v.length >= 6 ? v : (v === '0' ? d : v + d)));
    const back = () => setVal(v => v.slice(0, -1));
    const num = parseFloat(val);
    const valid = !isNaN(num) && num > 0;

    const submit = () => {
        if (!valid) return;
        const cb = cfg.onOK;
        onClose();
        cb(num);
    };

    return (
        <Sheet open onClose={onClose} title={cfg.title}>
            <div className="numpad-display">
                <div className={`numpad-value ${val ? '' : 'empty'}`}>
                    {val || (cfg.initial != null ? String(cfg.initial) : '0')}
                </div>
                <div className="numpad-unit">mm</div>
            </div>
            {cfg.hint && <div className="numpad-hint">{cfg.hint}</div>}
            <div className="numpad-grid">
                {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(d => (
                    <button key={d} className="numpad-key" onClick={() => press(d)}>{d}</button>
                ))}
                <button className="numpad-key fn" onClick={() => setVal('')}>C</button>
                <button className="numpad-key" onClick={() => press('0')}>0</button>
                <button className="numpad-key fn" onClick={back}><Delete size={22} /></button>
            </div>
            <div className="numpad-actions">
                <button className="btn" onClick={onClose}>Hủy</button>
                <button className="btn btn-primary" disabled={!valid} style={!valid ? { opacity: .45 } : {}} onClick={submit}>
                    ✓ Xác nhận
                </button>
            </div>
        </Sheet>
    );
}
