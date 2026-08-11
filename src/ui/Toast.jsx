import React, { useState, useEffect } from 'react';

let seq = 0;

export function toast(msg, type = 'info') {
    window.dispatchEvent(new CustomEvent('ks-toast', { detail: { id: ++seq, msg, type } }));
}

export function ToastHost() {
    const [items, setItems] = useState([]);
    useEffect(() => {
        const on = (e) => {
            const item = e.detail;
            setItems(list => [...list, item]);
            setTimeout(() => setItems(list => list.filter(i => i.id !== item.id)), 2600);
        };
        window.addEventListener('ks-toast', on);
        return () => window.removeEventListener('ks-toast', on);
    }, []);
    if (!items.length) return null;
    return (
        <div className="toast-host">
            {items.map(i => (
                <div key={i.id} className={`toast ${i.type === 'ok' ? 'ok' : i.type === 'err' ? 'err' : ''}`}>{i.msg}</div>
            ))}
        </div>
    );
}
