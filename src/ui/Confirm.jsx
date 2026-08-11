import React from 'react';
import Sheet from './Sheet';

/** Destructive-action confirm. cfg = { title, message, actionLabel, onOK } | null */
export default function Confirm({ cfg, onClose }) {
    if (!cfg) return null;
    return (
        <Sheet open onClose={onClose} title={cfg.title} sub={cfg.message}>
            <div className="numpad-actions">
                <button className="btn" onClick={onClose}>Hủy</button>
                <button className="btn btn-danger" onClick={() => { const cb = cfg.onOK; onClose(); cb(); }}>
                    {cfg.actionLabel || 'Xóa'}
                </button>
            </div>
        </Sheet>
    );
}
