import React, { useState, useEffect, useRef } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { genId } from '../lib/geometry';

/**
 * Bottom sheet for editing a checklist note.
 * cfg = { note: { id, x, y, items? }, onSave(updatedNote) } | null
 */
export default function ChecklistSheet({ cfg, onClose }) {
    const [items, setItems] = useState([]);
    const [draft, setDraft] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (!cfg) return;
        const note = cfg.note;
        setItems(note.items || (note.text ? [{ id: genId('i'), text: note.text, done: false }] : []));
        setDraft('');
    }, [cfg]);

    if (!cfg) return null;

    const toggle = (id) => setItems(prev => prev.map(it => it.id === id ? { ...it, done: !it.done } : it));
    const remove = (id) => setItems(prev => prev.filter(it => it.id !== id));

    const addItem = () => {
        const text = draft.trim();
        if (!text) return;
        setItems(prev => [...prev, { id: genId('i'), text, done: false }]);
        setDraft('');
        inputRef.current?.focus();
    };

    const save = () => {
        cfg.onSave({ ...cfg.note, items, text: undefined });
        onClose();
    };

    const doneCount = items.filter(it => it.done).length;

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <div className="sheet" onClick={e => e.stopPropagation()}>
                <div className="sheet-grip" />
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px 4px', gap: 8 }}>
                    <h3 className="sheet-title" style={{ flex: 1, margin: 0 }}>
                        Checklist {items.length > 0 && <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--muted)' }}>({doneCount}/{items.length} xong)</span>}
                    </h3>
                    <button className="icon-btn" onClick={onClose}><X size={20} /></button>
                </div>

                <div style={{ maxHeight: '40vh', overflowY: 'auto', padding: '4px 0' }}>
                    {items.length === 0 && (
                        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '18px 0', fontSize: 14 }}>
                            Chưa có hạng mục nào
                        </div>
                    )}
                    {items.map(it => (
                        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: '1px solid var(--line)' }}>
                            <button
                                onClick={() => toggle(it.id)}
                                style={{
                                    flexShrink: 0, width: 26, height: 26, borderRadius: 13,
                                    border: `2px solid ${it.done ? 'var(--ok)' : 'var(--line)'}`,
                                    background: it.done ? 'var(--ok)' : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer',
                                }}
                            >
                                {it.done && <Check size={13} color="#fff" strokeWidth={3} />}
                            </button>
                            <span style={{
                                flex: 1, fontSize: 15,
                                textDecoration: it.done ? 'line-through' : 'none',
                                color: it.done ? 'var(--muted)' : 'var(--fg)',
                            }}>
                                {it.text}
                            </span>
                            <button className="icon-btn" style={{ color: 'var(--muted)', flexShrink: 0 }} onClick={() => remove(it.id)}>
                                <Trash2 size={15} />
                            </button>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 8, padding: '12px 16px 8px' }}>
                    <input
                        ref={inputRef}
                        style={{
                            flex: 1, border: '1.5px solid var(--line)', borderRadius: 8,
                            padding: '9px 12px', fontSize: 15, background: 'var(--surface)', color: 'var(--fg)',
                            outline: 'none',
                        }}
                        placeholder="Thêm hạng mục..."
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                    />
                    <button
                        className="btn btn-primary"
                        style={{ flexShrink: 0, padding: '0 14px' }}
                        disabled={!draft.trim()}
                        onClick={addItem}
                    >
                        <Plus size={18} />
                    </button>
                </div>

                <div style={{ padding: '4px 16px 16px' }}>
                    <button className="btn btn-primary btn-block" onClick={save}>
                        Lưu
                    </button>
                </div>
            </div>
        </div>
    );
}
