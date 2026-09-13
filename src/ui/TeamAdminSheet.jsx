import React, { useState, useEffect } from 'react';
import {
    Users, Plus, ArrowLeft, Trash2, Copy, RefreshCw, AlertCircle, UserPlus, Database, ShieldCheck,
    Send, UserRoundCheck,
} from 'lucide-react';
import Sheet from './Sheet';
import { toast } from './Toast';
import { downloadText } from '../lib/export';
import * as pb from '../lib/pb';

/**
 * Quản lý team, nhân viên và khách hàng. `role=admin` được cấp/sửa người dùng; riêng
 * thao tác dựng schema vẫn bắt buộc superuser PocketBase và server rule là lớp bảo vệ thật.
 */
export default function TeamAdminSheet({ open, onClose }) {
    const [teams, setTeams] = useState(null);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null); // team object đang xem thành viên
    const [members, setMembers] = useState(null);
    const [customers, setCustomers] = useState(null);
    const [creatingTeam, setCreatingTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [addForm, setAddForm] = useState(null); // { email, name, password } | null
    const [revealed, setRevealed] = useState(null); // { email, password } — hiện một lần sau khi tạo
    const [busy, setBusy] = useState(false);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [setupLog, setSetupLog] = useState(null); // dòng tiến độ đang chạy
    const [confirmSetup, setConfirmSetup] = useState(false);
    const [inspect, setInspect] = useState(null); // kết quả kiểm tra trước khi ghi
    const [seeded, setSeeded] = useState(null);    // { team, users } — bảng PIN hiện một lần
    const [report, setReport] = useState(null);    // { log, warnings } sau khi dựng
    const [confirmReassign, setConfirmReassign] = useState(null); // team object
    const [customerForm, setCustomerForm] = useState(null); // { login, name, pin }
    const [customerRevealed, setCustomerRevealed] = useState(null);

    useEffect(() => {
        if (open) {
            load(); setSelected(null); setRevealed(null); setAddForm(null); setConfirmSetup(false);
            setCustomers(null); setCustomerForm(null); setCustomerRevealed(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const load = async () => {
        setError(null);
        setNeedsSetup(false);
        try {
            setTeams(await pb.listTeams());
            // Superuser luôn kiểm tra version schema khi mở màn này. Trước đây chỉ kiểm
            // khi bảng teams chưa tồn tại, nên backend có teams nhưng thiếu scope/team
            // hoặc cổng khách hàng không bao giờ hiện nút nâng cấp.
            if (pb.isSuperuser()) {
                const state = await pb.inspectBackend();
                setInspect(state);
                setNeedsSetup(!state.ready);
            }
        } catch (err) {
            // 404 = collection `teams` chưa tồn tại. Trước đây chỗ này chỉ bảo người dùng đi
            // chạy script CLI — không làm được từ điện thoại. Giờ dựng thẳng trong app.
            if (err.status === 404 && pb.isSuperuser()) {
                setNeedsSetup(true);
                setError(null);
            } else {
                setError(err.status === 404
                    ? 'Backend chưa dựng xong — cần tài khoản quản trị để khởi tạo.'
                    : err.message);
            }
            setTeams([]);
        }
    };

    const doInspect = async () => {
        setBusy(true);
        setSetupLog('Đang đọc cấu trúc trên máy chủ...');
        try {
            const r = await pb.inspectBackend();
            setInspect(r);
            setNeedsSetup(!r.ready);
            setSetupLog(null);
        } catch (err) {
            setSetupLog(null);
            setError('Không đọc được cấu trúc: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    const doProvision = async () => {
        setBusy(true);
        setSetupLog('Đang kiểm tra backend...');
        try {
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const res = await pb.provisionBackend(
                (msg) => setSetupLog(msg),
                (json) => downloadText(json, `pb-schema-backup-${stamp}.json`, 'application/json'),
            );
            setSetupLog(null);
            setNeedsSetup(false);
            setConfirmSetup(false);
            await load();
            // Nhật ký phải HIỆN LÊN màn hình, không chỉ nằm trong console: người dùng đang
            // đứng ở điện thoại, không mở được DevTools để biết bước nào chưa đạt.
            setReport(res);
            toast(res.warnings.length
                ? `Dựng xong nhưng ${res.warnings.length} bước chưa đạt`
                : 'Đã dựng xong backend — cấp tài khoản được rồi',
                res.warnings.length ? 'err' : 'ok');
        } catch (err) {
            setSetupLog(null);
            setError('Dựng backend thất bại: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    const doSeedUsers = async () => {
        setBusy(true);
        setSetupLog('Đang cấp tài khoản...');
        try {
            const r = await pb.provisionUsers((msg) => setSetupLog(msg));
            setSetupLog(null);
            await load();
            setSeeded(r);
            const made = r.users.filter(u => u.created).length;
            toast(made ? `Đã tạo ${made} tài khoản` : 'Tài khoản đã có đủ từ trước', 'ok');
        } catch (err) {
            setSetupLog(null);
            setError('Không cấp được tài khoản: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    const doAddAdmins = async () => {
        setBusy(true);
        setSetupLog('Đang nạp quản trị vào các đội...');
        try {
            const r = await pb.addAdminsToAllTeams((m) => setSetupLog(m));
            setSetupLog(null);
            await load();
            toast(r.touched
                ? `Đã thêm ${r.admins} quản trị vào ${r.touched}/${r.teams} đội`
                : 'Mọi đội đã có đủ quản trị', 'ok');
        } catch (err) {
            setSetupLog(null);
            toast('Không thêm được: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const doReassign = async (teamId) => {
        setBusy(true);
        setSetupLog('Đang gom bản ghi về Founder...');
        try {
            const r = await pb.reassignAllToOwner(pb.ownerId(), teamId, (m) => setSetupLog(m));
            setSetupLog(null);
            setConfirmReassign(null);
            const bits = [`chuyển ${r.moved}/${r.total} bản ghi`];
            if (r.skipped) bits.push(`bỏ qua ${r.skipped}`);
            if (r.conflicts.length) bits.push(`${r.conflicts.length} trùng item_id`);
            setReport({ log: [`Gom chủ sở hữu: ${bits.join(', ')}`], warnings: r.conflicts.length ? ['⚠ có bản ghi trùng item_id, xem console'] : [] });
            if (r.conflicts.length) console.warn('reassign conflicts:', r.conflicts);
            toast(`Đã chuyển ${r.moved} bản ghi về Founder`, 'ok');
        } catch (err) {
            setSetupLog(null);
            setError('Không chuyển được chủ sở hữu: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    const openTeam = async (t) => {
        setSelected(t);
        setMembers(null);
        setCustomers(null);
        setAddForm(null);
        setCustomerForm(null);
        setCustomerRevealed(null);
        try {
            const [teamMembers, teamCustomers] = await Promise.all([
                pb.getTeamMembers(t.id), pb.isAdmin() ? pb.listCustomers(t.id) : Promise.resolve([]),
            ]);
            setMembers(teamMembers);
            setCustomers(teamCustomers);
        } catch (err) {
            toast('Không tải được thành viên/khách: ' + err.message, 'err');
            setMembers([]); setCustomers([]);
        }
    };

    const doCreateCustomer = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const made = await pb.createCustomer(selected.id, customerForm || {});
            const row = {
                id: made.id, userId: made.userId, teamId: selected.id,
                name: customerForm?.name || made.login, phone: customerForm?.login || '',
                login: made.login, active: true,
            };
            setCustomers(list => [...(list || []).filter(c => c.id !== row.id), row]);
            setCustomerForm(null);
            setCustomerRevealed({ login: made.login, pin: made.pin, created: made.created });
            toast(made.created ? 'Đã tạo tài khoản khách hàng' : 'Đã cập nhật tuyến nhận của khách', 'ok');
        } catch (err) {
            toast('Không tạo được tài khoản khách: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const doCreateTeam = async () => {
        const name = newTeamName.trim();
        if (!name || busy) return;
        setBusy(true);
        try {
            await pb.createTeam(name);
            setNewTeamName('');
            setCreatingTeam(false);
            await load();
            toast(`Đã tạo team ${name}`, 'ok');
        } catch (err) {
            toast('Không tạo được team: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    // Đếm lại thành viên tại chỗ thay vì gọi load() — load() tải lại TOÀN BỘ danh sách
    // team chỉ để sửa một con số, và làm cả màn hình nháy.
    const bumpCount = (delta) => setTeams(ts => (ts || []).map(t =>
        t.id === selected?.id ? { ...t, memberCount: Math.max(0, (t.memberCount || 0) + delta) } : t));

    const doAddMember = async () => {
        const email = (addForm?.email || '').trim();
        if (!email.includes('@')) { toast('Nhập email hợp lệ', 'err'); return; }
        setBusy(true);
        try {
            const res = await pb.addTeamMember(selected.id, email, {
                name: addForm.name, password: addForm.password,
            });
            setAddForm(null);
            // Gắn thẳng vào danh sách đang hiện. Trước đây chỗ này gọi openTeam() + load()
            // = 3 lượt mạng nữa, danh sách xoá trắng rồi vẽ lại — chờ lâu và giật.
            setMembers(ms => {
                const cur = ms || [];
                if (cur.some(m => m.id === res.userId)) return cur;
                return [...cur, { id: res.userId, email: res.email, name: (addForm.name || '').trim() || res.email }];
            });
            if (res.created) bumpCount(1);
            if (res.created && res.password) setRevealed({ email: res.email, password: res.password });
            else toast('Đã thêm vào team', 'ok');
        } catch (err) {
            toast('Không thêm được: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const doRemove = async (m) => {
        // Bỏ khỏi danh sách NGAY, gọi server sau. Xoá là thao tác người dùng đã quyết —
        // bắt họ nhìn spinner vài giây rồi mới thấy dòng biến mất là vô nghĩa. Hỏng thì
        // trả lại đúng chỗ cũ và báo.
        const prev = members || [];
        setMembers(prev.filter(x => x.id !== m.id));
        bumpCount(-1);
        try {
            await pb.removeTeamMember(selected.id, m.id);
        } catch (err) {
            setMembers(prev);
            bumpCount(1);
            toast('Không xóa được: ' + err.message, 'err');
        }
    };

    const copy = async (text) => {
        try { await navigator.clipboard.writeText(text); toast('Đã copy', 'ok'); }
        catch { toast('Không copy được — bấm giữ để chọn', 'err'); }
    };

    return (
        <Sheet open={open} onClose={onClose}
            title={selected ? `Team ${selected.name}` : 'Quản lý team & người dùng'}
            sub={selected ? undefined : 'Chỉ quản trị viên nhìn thấy mục này'}>

            {selected && (
                <button className="sheet-row" onClick={() => { setSelected(null); setRevealed(null); setAddForm(null); }}>
                    <ArrowLeft size={19} style={{ color: 'var(--ink-2)' }} />
                    <div style={{ flex: 1 }}>Quay lại danh sách team</div>
                </button>
            )}

            {error && (
                <div style={{ padding: '12px 16px', color: '#dc2626', fontSize: 13.5, display: 'flex', gap: 8 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                </div>
            )}

            {/* ===== Backend chưa dựng — làm ngay tại đây, không cần terminal ===== */}
            {needsSetup && !selected && (
                <div style={{ padding: '4px 16px 16px' }}>
                    <div style={{
                        padding: 14, borderRadius: 12,
                        background: 'var(--warn-soft)', border: '1px solid #f0d999',
                    }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <Database size={17} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />
                            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)' }}>
                                <b>Backend chưa dựng xong.</b> Máy chủ còn thiếu bảng/quyền cho
                                team, đồng bộ nội bộ hoặc cổng khách hàng.
                            </div>
                        </div>

                        {inspect && !busy && (
                            <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-2)' }}>
                                <b style={{ color: 'var(--ink)' }}>Máy chủ đang thiếu:</b>
                                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                    {!inspect.teams && <li>bảng <code>teams</code></li>}
                                    {!inspect.shares && <li>bảng <code>shares</code></li>}
                                    {!inspect.deletions && <li>bảng <code>deletions</code></li>}
                                    {!inspect.customerProfilesReady && <li>bảng <code>customer_profiles</code></li>}
                                    {!inspect.customerSubmissionsReady && <li>bảng <code>customer_submissions</code></li>}
                                    {!inspect.customerRole && <li>vai trò <code>customer</code></li>}
                                    {inspect.missingFields.length > 0 && <li>cột: {inspect.missingFields.join(', ')}</li>}
                                    {inspect.missingIndexes.length > 0 && <li>{inspect.missingIndexes.length} index</li>}
                                    {!inspect.rulesOk && <li>quyền truy cập theo team</li>}
                                    {!inspect.auxiliaryRulesOk && <li>quyền bảng <code>shares/deletions</code></li>}
                                    {inspect.ready && <li>(không thiếu gì)</li>}
                                </ul>
                            </div>
                        )}

                        {!confirmSetup && !busy && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button className="btn" style={{ flex: 1, border: '1.5px solid var(--line)', background: 'none' }}
                                    onClick={doInspect}>
                                    Kiểm tra trước
                                </button>
                                <button className="btn btn-primary" style={{ flex: 1 }}
                                    onClick={() => setConfirmSetup(true)}>
                                    <Database size={16} /> Dựng ngay
                                </button>
                            </div>
                        )}

                        {confirmSetup && !busy && (
                            <>
                                <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 10, color: 'var(--ink-2)' }}>
                                    Thao tác này sẽ đổi cấu trúc dữ liệu trên máy chủ <b>db.mkg.vn</b>:
                                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                                        <li>Tạo bảng <code>teams</code> và <code>shares</code></li>
                                        <li>Tạo hộp thư <code>customer_submissions</code> tách khỏi dữ liệu nội bộ</li>
                                        <li>Bật vai trò và hồ sơ tuyến nhận cho khách hàng</li>
                                        <li>Thêm cột vào <code>survey_items</code> (không xoá cột nào)</li>
                                        <li>Đặt lại quyền truy cập theo team</li>
                                        <li>Tạo team MKG ban đầu, các lần sau giữ nguyên phân đội</li>
                                        <li>Chuẩn hóa dữ liệu cũ để máy chủ nhận đúng schema mới</li>
                                    </ul>
                                    <div style={{ marginTop: 8 }}>
                                        Bản sao cấu trúc cũ sẽ tự tải về máy trước khi sửa. Chạy lại nhiều
                                        lần vẫn an toàn. Nên làm lúc cả nhà không ai đang nhập liệu.
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmSetup(false)}>Để sau</button>
                                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={doProvision}>
                                        Tôi hiểu, dựng
                                    </button>
                                </div>
                            </>
                        )}

                        {busy && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13, color: 'var(--ink-2)' }}>
                                <RefreshCw size={15} className="spin" />
                                {setupLog || 'Đang dựng...'}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ===== Danh sách team ===== */}
            {!selected && !error && !needsSetup && (
                <>
                    {teams === null && (
                        <div style={{ padding: '16px', display: 'flex', gap: 8, color: 'var(--muted)', fontSize: 13.5 }}>
                            <RefreshCw size={15} className="spin" /> Đang tải...
                        </div>
                    )}
                    {teams?.map(t => (
                        <button key={t.id} className="sheet-row" onClick={() => openTeam(t)}>
                            <Users size={19} style={{ color: 'var(--blue)' }} />
                            <div style={{ flex: 1 }}>{t.name}<div className="sub">{t.memberCount} thành viên</div></div>
                        </button>
                    ))}

                    {report && (
                        <div style={{
                            margin: '12px 16px', padding: 12, borderRadius: 12,
                            background: report.warnings.length ? 'var(--warn-soft)' : 'var(--bg-2)',
                            fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                            fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word',
                        }}>
                            {report.log.join('\n')}
                            <button className="btn btn-block" style={{ marginTop: 10 }}
                                onClick={() => setReport(null)}>Đóng nhật ký</button>
                        </div>
                    )}

                    {pb.isAdmin() && teams?.length > 0 && (
                        <div style={{ padding: '12px 16px 0' }}>
                            <button className="btn btn-block" disabled={busy}
                                style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                onClick={doAddAdmins}>
                                <ShieldCheck size={17} /> Thêm quản trị vào mọi đội
                            </button>
                        </div>
                    )}

                    {/* Gom chủ sở hữu — sửa hệ quả của việc "nhận dữ liệu chưa đăng nhập" */}
                    {pb.isSuperuser() && teams?.length > 0 && (
                        confirmReassign ? (
                            <div style={{ margin: '12px 16px', padding: 14, borderRadius: 12, background: 'var(--warn-soft)' }}>
                                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
                                    Gom toàn bộ dữ liệu về Founder, đội {confirmReassign.name}?
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                                    Mọi bản ghi trên <b>db.mkg.vn</b> sẽ đổi chủ sở hữu sang{' '}
                                    <b>{pb.ownerName() || 'Founder'}</b>, đặt phạm vi đội và gắn vào đội{' '}
                                    <b>{confirmReassign.name}</b>. Nội dung khảo sát KHÔNG bị sửa.
                                    <div style={{ marginTop: 6 }}>
                                        Cần khi một tài khoản đã vô tình nhận cả kho dự án của công ty — vì
                                        quyền xoá bám theo chủ sở hữu, để nguyên là chỉ tài khoản đó xoá được.
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn" style={{ flex: 1 }} disabled={busy}
                                        onClick={() => setConfirmReassign(null)}>Để sau</button>
                                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy}
                                        onClick={() => doReassign(confirmReassign.id)}>Gom lại</button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ padding: '12px 16px 0' }}>
                                <button className="btn btn-block" disabled={busy}
                                    style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                    onClick={() => setConfirmReassign(teams.find(t => t.slug === 'mkg') || teams[0])}>
                                    <Database size={17} /> Gom chủ sở hữu về Founder
                                </button>
                            </div>
                        )
                    )}

                    {/* Cấp sẵn tổ khảo sát — thao tác một lần, bấm lại không reset PIN ai */}
                    {seeded ? (
                        <div style={{ margin: '12px 16px', padding: 14, borderRadius: 12, background: 'var(--warn-soft)' }}>
                            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>
                                Tài khoản đã cấp — team {seeded.team.name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 10, lineHeight: 1.5 }}>
                                PIN chỉ hiện MỘT LẦN ở đây. Copy đi giao, rồi nhắc mỗi người vào
                                Cài đặt → Đổi mã PIN. Chưa ai đổi thì ai cũng vào được tên người khác,
                                và cột "người sửa" trên bản ghi chưa đáng tin.
                            </div>
                            {seeded.users.map(u => (
                                <div key={u.username} style={{
                                    display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13,
                                    fontFamily: 'ui-monospace, monospace', padding: '3px 0',
                                }}>
                                    <span style={{ fontWeight: 700, minWidth: 58 }}>{u.username}</span>
                                    <span style={{ flex: 1 }}>{u.pin ? `PIN ${u.pin}` : 'đã có từ trước — PIN không đổi'}</span>
                                    {u.role === 'admin' && <span style={{ fontSize: 10.5, color: 'var(--blue)' }}>QUẢN TRỊ</span>}
                                </div>
                            ))}
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button className="btn" style={{ flex: 1 }}
                                    onClick={() => copy(seeded.users.filter(u => u.pin)
                                        .map(u => `${u.username} / ${u.pin}`).join('\n') || 'Không có PIN mới')}>
                                    <Copy size={15} /> Copy
                                </button>
                                <button className="btn" style={{ flex: 1 }} onClick={() => setSeeded(null)}>Đóng</button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ padding: '12px 16px 0' }}>
                            <button className="btn btn-block" disabled={busy}
                                style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                onClick={doSeedUsers}>
                                <UserPlus size={17} /> Cấp sẵn tổ khảo sát (kts1–kts4 + admin)
                            </button>
                        </div>
                    )}

                    <div style={{ padding: '12px 16px' }}>
                        {creatingTeam ? (
                            <div className="field">
                                <label>Tên team mới</label>
                                <input autoFocus type="text" value={newTeamName} placeholder="VD: Academy"
                                    onChange={e => setNewTeamName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') doCreateTeam(); }} />
                                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button className="btn" style={{ flex: 1 }} onClick={() => { setCreatingTeam(false); setNewTeamName(''); }}>Hủy</button>
                                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !newTeamName.trim()} onClick={doCreateTeam}>
                                        Tạo
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button className="btn btn-block" style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                onClick={() => setCreatingTeam(true)}>
                                <Plus size={17} /> Team mới
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* ===== Thành viên của 1 team ===== */}
            {selected && (
                <>
                    {members === null && (
                        <div style={{ padding: '16px', display: 'flex', gap: 8, color: 'var(--muted)', fontSize: 13.5 }}>
                            <RefreshCw size={15} className="spin" /> Đang tải thành viên...
                        </div>
                    )}
                    {members?.length === 0 && (
                        <div style={{ padding: '16px', color: 'var(--muted)', fontSize: 13.5 }}>Chưa có thành viên</div>
                    )}
                    {members?.map(m => (
                        <div key={m.id} className="sheet-row">
                            <Users size={17} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                                {m.email && <div className="sub">{m.email}</div>}
                            </div>
                            <button className="icon-btn" style={{ color: '#dc2626' }} onClick={() => doRemove(m)} title="Xóa khỏi team">
                                <Trash2 size={17} />
                            </button>
                        </div>
                    ))}

                    {revealed && (
                        <div style={{ margin: '10px 16px', padding: 12, borderRadius: 10, background: 'var(--warn-soft)', border: '1px solid #f0d999' }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--warn)', marginBottom: 6 }}>
                                Lưu lại ngay — mật khẩu chỉ hiện một lần
                            </div>
                            <div style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>{revealed.email}</div>
                            <div style={{ fontSize: 15, fontFamily: 'ui-monospace, monospace', fontWeight: 700, marginTop: 2 }}>
                                {revealed.password}
                            </div>
                            <button className="btn" style={{ marginTop: 8, border: '1.5px solid var(--line)', background: 'none' }}
                                onClick={() => copy(`${revealed.email} / ${revealed.password}`)}>
                                <Copy size={15} /> Copy
                            </button>
                        </div>
                    )}

                    {pb.isAdmin() && (
                        <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
                            <div style={{ padding: '8px 16px 4px', fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
                                KHÁCH HÀNG GỬI KHẢO SÁT VỀ TEAM NÀY
                            </div>
                            {customers === null && (
                                <div style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: 13 }}>
                                    <RefreshCw size={14} className="spin" /> Đang tải khách hàng...
                                </div>
                            )}
                            {customers?.map(c => (
                                <div key={c.id} className="sheet-row">
                                    <UserRoundCheck size={17} style={{ color: 'var(--blue)' }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div>{c.name || c.login}</div>
                                        <div className="sub">Đăng nhập: {c.login}{c.active ? '' : ' · đã khóa'}</div>
                                    </div>
                                </div>
                            ))}

                            {customerRevealed && (
                                <div style={{ margin: '10px 16px', padding: 12, borderRadius: 10, background: 'var(--warn-soft)' }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--warn)', marginBottom: 6 }}>
                                        Gửi thông tin này cho khách
                                    </div>
                                    <div style={{ fontSize: 13 }}>Trang khách: {window.location.origin}/?customer=1</div>
                                    <div style={{ fontSize: 13 }}>Đăng nhập: <b>{customerRevealed.login}</b></div>
                                    <div style={{ fontSize: 13 }}>
                                        {customerRevealed.pin ? <>PIN: <b>{customerRevealed.pin}</b></> : 'Tài khoản đã có — PIN không thay đổi'}
                                    </div>
                                    <button className="btn" style={{ marginTop: 8 }} onClick={() => copy(
                                        `MKG Khảo Sát cho khách\n${window.location.origin}/?customer=1\nTài khoản: ${customerRevealed.login}`
                                        + (customerRevealed.pin ? `\nPIN: ${customerRevealed.pin}` : '')
                                    )}>
                                        <Copy size={15} /> Copy thông tin gửi khách
                                    </button>
                                </div>
                            )}

                            {customerForm ? (
                                <div style={{ padding: '12px 16px' }}>
                                    <div className="field">
                                        <label>Số điện thoại hoặc tên đăng nhập</label>
                                        <input autoFocus type="text" value={customerForm.login} placeholder="0901234567"
                                            onChange={e => setCustomerForm(f => ({ ...f, login: e.target.value }))} />
                                    </div>
                                    <div className="field">
                                        <label>Tên khách hàng</label>
                                        <input type="text" value={customerForm.name} placeholder="Anh Minh"
                                            onChange={e => setCustomerForm(f => ({ ...f, name: e.target.value }))} />
                                    </div>
                                    <div className="field">
                                        <label>PIN {pb.PIN_MIN}–{pb.PIN_MAX} số</label>
                                        <input type="text" inputMode="numeric" value={customerForm.pin} placeholder="Ví dụ: 2580"
                                            onChange={e => setCustomerForm(f => ({ ...f, pin: e.target.value }))}
                                            onKeyDown={e => { if (e.key === 'Enter') doCreateCustomer(); }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button className="btn" style={{ flex: 1 }} onClick={() => setCustomerForm(null)}>Hủy</button>
                                        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={doCreateCustomer}>
                                            {busy ? <RefreshCw size={15} className="spin" /> : <Send size={15} />} Tạo cho khách
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ padding: '12px 16px' }}>
                                    <button className="btn btn-block" style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                        onClick={() => { setCustomerForm({ login: '', name: '', pin: '' }); setCustomerRevealed(null); }}>
                                        <UserRoundCheck size={17} /> Tạo tài khoản khách hàng
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {addForm ? (
                        <div style={{ padding: '12px 16px' }}>
                            <div className="field">
                                <label>Email</label>
                                <input autoFocus type="text" value={addForm.email} placeholder="ten@mkg.vn"
                                    onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label>Tên hiển thị (tùy chọn)</label>
                                <input type="text" value={addForm.name} placeholder="Nguyễn Văn A"
                                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label>Mã PIN {pb.PIN_MIN}–{pb.PIN_MAX} số (bỏ trống để tự sinh mật khẩu)</label>
                                <input type="text" value={addForm.password} placeholder="Tự sinh ngẫu nhiên"
                                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') doAddMember(); }} />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" style={{ flex: 1 }} onClick={() => setAddForm(null)}>Hủy</button>
                                <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={doAddMember}>
                                    {busy ? <RefreshCw size={15} className="spin" /> : <UserPlus size={15} />} Thêm
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ padding: '12px 16px' }}>
                            <button className="btn btn-block" style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                onClick={() => { setAddForm({ email: '', name: '', password: '' }); setRevealed(null); }}>
                                <UserPlus size={17} /> Thêm người vào team
                            </button>
                        </div>
                    )}
                </>
            )}
        </Sheet>
    );
}
