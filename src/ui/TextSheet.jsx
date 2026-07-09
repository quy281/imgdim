import React, { useState, useEffect, useRef } from 'react';
import Sheet from './Sheet';

/**
 * Single-field text input sheet (names, notes, room rename).
 * cfg = { title, label, initial, placeholder, onOK(text) } | null
 */
export default function TextSheet({ cfg, onClose }) {
    const [val, setVal] = useState('');
    const inputRef = useRef(null);
    useEffect(() => {
        setVal(cfg?.initial || '');
        if (cfg) setTimeout(() => inputRef.current?.focus(), 120);
    }, [cfg]);
    if (!cfg) return null;

    const submit = () => {
        const text = val.trim();
        if (!text) return;
        const cb = cfg.onOK;
        onClose();
        cb(text);
    };

    return (
        <Sheet open onClose={onClose} title={cfg.title}>
            <div className="field">
                {cfg.label && <label>{cfg.label}</label>}
                <input
                    ref={inputRef}
                    type="text"
                    value={val}
                    placeholder={cfg.placeholder || ''}
                    onChange={e => setVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                />
            </div>
            <div className="numpad-actions">
                <button className="btn" onClick={onClose}>Hủy</button>
                <button className="btn btn-primary" disabled={!val.trim()} style={!val.trim() ? { opacity: .45 } : {}} onClick={submit}>
                    ✓ Lưu
                </button>
            </div>
        </Sheet>
    );
}
