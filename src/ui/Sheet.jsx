import React from 'react';

/** Bottom sheet modal. */
export default function Sheet({ open, onClose, title, sub, children }) {
    if (!open) return null;
    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <div className="sheet" onClick={e => e.stopPropagation()}>
                <div className="sheet-grip" />
                {title && <h3 className="sheet-title">{title}</h3>}
                {sub && <p className="sheet-sub">{sub}</p>}
                {children}
            </div>
        </div>
    );
}
