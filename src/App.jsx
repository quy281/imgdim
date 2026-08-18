import React, { useState, useEffect, useRef, useCallback } from 'react';
import ProjectsScreen from './screens/ProjectsScreen';
import ProjectScreen from './screens/ProjectScreen';
import PlanEditor from './screens/PlanEditor';
import PhotoEditor from './screens/PhotoEditor';
import SyncStatusSheet from './ui/SyncStatusSheet';
import ShareSheet from './ui/ShareSheet';
import TeamAdminSheet from './ui/TeamAdminSheet';
import ShareViewer from './screens/ShareViewer';
import { ToastHost, toast } from './ui/Toast';
import * as db from './lib/db';
import * as pb from './lib/pb';
import { newProject, newPlanDoc, newPhotoDoc } from './lib/planModel';
import { fileToPhoto, makePlanThumb } from './lib/image';

/** Đọc tham số share từ URL: ?s=<code> (mới) hoặc ?view=<base64> (link cũ đã gửi ra). */
function readShareParam() {
    const sp = new URLSearchParams(window.location.search);
    const code = sp.get('s');
    if (code) return { code };
    const v = sp.get('view');
    if (!v) return null;
    try {
        // URLSearchParams giải '+' thành khoảng trắng — link cũ build bằng btoa nên
        // phải trả '+' về trước khi atob, nếu không mọi link cũ đều vỡ.
        const b64 = v.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
        return { data: JSON.parse(decodeURIComponent(escape(atob(b64)))) };
    } catch {
        try { return { data: JSON.parse(atob(v.replace(/ /g, '+'))) }; } catch { return { error: true }; }
    }
}

export default function App() {
    const [projects, setProjects] = useState(null); // null = đang tải
    const [route, setRoute] = useState({ screen: 'projects' });
    const [docs, setDocs] = useState([]);           // doc của dự án đang mở
    const [syncBusy, setSyncBusy] = useState(false);
    const [syncMsg, setSyncMsg] = useState(null);
    const [lastSyncAt, setLastSyncAt] = useState(null);
    const [showSyncStatus, setShowSyncStatus] = useState(false);
    const [showTeamAdmin, setShowTeamAdmin] = useState(false);
    const [shareFor, setShareFor] = useState(null); // project object
    const [account, setAccount] = useState(() => pb.me());
    const share = useRef(readShareParam()).current;

    const projectsRef = useRef([]);
    useEffect(() => { projectsRef.current = projects || []; }, [projects]);
    const routeRef = useRef(route);
    useEffect(() => { routeRef.current = route; }, [route]);
    const docsRef = useRef([]);
    useEffect(() => { docsRef.current = docs; }, [docs]);

    const saveTimers = useRef(new Map()); // docId -> timeout (doc đang có sửa chưa lưu)
    const syncTimer = useRef(null);       // trigger sync có debounce
    const syncBusyRef = useRef(false);    // chặn sync chạy trùng (tránh stale closure)
    const syncAgain = useRef(false);      // có thay đổi mới trong lúc đang sync

    // ===== Boot =====
    useEffect(() => {
        if (share) return; // chế độ xem link chia sẻ: không chạm dữ liệu local
        (async () => {
            // Mở store đúng tài khoản TRƯỚC khi đọc bất cứ gì (xem db.js — lớp user).
            await db.setAccount(pb.myId() || db.lastStoreId());
            setProjects(await db.loadProjects());
            if (!pb.isLoggedIn()) return;
            // Xác thực token thật với server trước khi tin là đang đăng nhập — xem
            // pb.ensureSession(): PocketBase trả 200 rỗng cho token hết hạn, nên nếu chỉ
            // tin localStorage thì app báo "đã sync" trong khi thực tế là khách.
            // Phân biệt "đủ 30 ngày" với "token bị thu hồi" — ensureSession đã xoá auth
            // nên phải đọc cờ TRƯỚC, không thì chỉ báo được thông điệp chung chung.
            const expired = pb.sessionExpired();
            if (await pb.ensureSession(true)) syncAll(true);
            else {
                setAccount(null);
                toast(expired
                    ? `Phiên đã dùng đủ ${pb.SESSION_DAYS} ngày — đăng nhập lại bằng PIN`
                    : 'Phiên đăng nhập hết hạn — đăng nhập lại để đồng bộ', 'err');
            }
        })();
        history.replaceState({ screen: 'projects' }, '');
        const onPop = (e) => setRoute(e.state || { screen: 'projects' });
        window.addEventListener('popstate', onPop);
        const onVisible = () => {
            if (document.visibilityState === 'visible' && pb.isLoggedIn()) syncAll(true);
        };
        const onOnline = () => { if (pb.isLoggedIn()) syncAll(true); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            window.removeEventListener('popstate', onPop);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const navigate = (r) => {
        setRoute(r);
        history.pushState(r, '');
    };
    const goBack = () => history.back();

    // ===== Dirty flag + sync có debounce =====
    const markDirty = (kind, item) => {
        db.markPending(item.id, kind);
        if (!pb.isLoggedIn()) return;
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => {
            syncTimer.current = null;
            syncAll(true);
        }, 5000);
    };

    // ===== Projects =====
    // Mọi lần ghi đều đọc-sửa-ghi qua db.mutateProjects: sync chạy 10-60s, nếu ghi từ
    // ảnh chụp cũ thì dự án tạo chen vào giữa sẽ bị xóa mất.
    const persistProjects = async (fn) => {
        const next = await db.mutateProjects(fn);
        setProjects(next);
        return next;
    };

    const createProject = async (name) => {
        // ownerId() chứ không phải myId(): với tài khoản superuser, myId() là id trong
        // bảng _superusers — không khớp với owner thật sự sẽ ghi lên cloud (xem pb.js).
        const p = { ...newProject(name), ownerId: pb.ownerId() || null, updatedAt: pb.now(), createdAt: pb.now() };
        await persistProjects(list => [p, ...list]);
        markDirty('project', p);
        setDocs([]);
        navigate({ screen: 'project', projectId: p.id });
    };

    const renameProject = async (id, name) => {
        const list = await persistProjects(l => l.map(p => p.id === id ? { ...p, name, updatedAt: pb.now() } : p));
        const p = list.find(x => x.id === id);
        if (p) markDirty('project', p);
    };

    // team = { id, name } khi scope='team' (ProjectsScreen truyền team cụ thể khi có >1
    // lựa chọn; bỏ trống thì giữ team cũ của dự án, hoặc team chính nếu dự án chưa có).
    const setProjectScope = async (id, scope, team) => {
        const list = await persistProjects(l => l.map(p => p.id === id
            ? { ...p, scope, teamId: scope === 'team' ? (team?.id || p.teamId || null) : null, updatedAt: pb.now() }
            : p));
        const p = list.find(x => x.id === id);
        if (!p) return;
        // Đổi phạm vi phải đẩy lại CẢ doc của dự án (record doc mang scope riêng), nên
        // ghi ý định xuống đĩa — offline lúc này thì lần sync sau vẫn làm.
        const meta = await db.getMeta();
        const dirty = new Set([...(meta.scopeDirty || []), String(id)]);
        await db.setMeta({ scopeDirty: [...dirty] });
        markDirty('project', p);
        toast(scope === 'team' ? `Đã chia sẻ cho team ${team?.name || pb.myTeam()?.name || 'MKG'}` : 'Đã chuyển về riêng tư', 'ok');
        if (pb.isLoggedIn()) syncAll(true);
    };

    const deleteProject = async (id) => {
        const docIds = await db.deleteProjectDocs(id);
        await persistProjects(l => l.filter(p => p.id !== id));
        // Tombstone ghi cho MỌI lần xóa, kể cả offline / chưa đăng nhập — nếu không thì
        // sync sau kéo bản trên cloud về và dự án "hồi sinh".
        const at = pb.now();
        await db.addTombstone(String(id), 'project', at);
        for (const docId of docIds) await db.addTombstone(String(docId), 'doc', at);
        toast('Đã xóa dự án', 'ok');
        if (pb.isLoggedIn()) syncAll(true);
    };

    // ===== Mở dự án / doc =====
    const openProject = async (id) => {
        setDocs(await db.listDocs(id));
        navigate({ screen: 'project', projectId: id });
    };

    const openDoc = (doc) => {
        navigate({ screen: doc.type === 'plan' ? 'plan' : 'photo', projectId: doc.projectId, docId: doc.id });
    };

    // ===== Lưu doc =====
    const updateDoc = useCallback((doc) => {
        setDocs(prev => prev.map(d => d.id === doc.id ? doc : d));
        const timers = saveTimers.current;
        if (timers.has(doc.id)) clearTimeout(timers.get(doc.id));
        timers.set(doc.id, setTimeout(() => {
            timers.delete(doc.id);
            // Stamp updatedAt tại ĐÚNG MỘT CHỖ. Trước đây các nhánh đổi settings/view gọi
            // onChange mà không bump updatedAt → thay đổi không bao giờ push, rồi bị pull
            // ghi đè bằng bản cloud cũ.
            const toSave = {
                ...doc,
                updatedAt: pb.now(),
                ...(doc.type === 'plan' ? { thumb: makePlanThumb(doc.plan) } : null),
            };
            db.putDoc(toSave);
            setDocs(prev => prev.map(d => d.id === toSave.id ? toSave : d));
            markDirty('doc', toSave);
            if (syncBusyRef.current) syncAgain.current = true;
        }, 400));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const createPlanDoc = async () => {
        const projectId = routeRef.current.projectId;
        const count = docsRef.current.filter(d => d.type === 'plan').length + 1;
        const doc = { ...newPlanDoc(projectId, `Mặt bằng ${count}`), createdAt: pb.now(), updatedAt: pb.now() };
        await db.putDoc(doc);
        setDocs(prev => [...prev, doc]);
        markDirty('doc', doc);
        navigate({ screen: 'plan', projectId, docId: doc.id });
    };

    const importPhotos = async (files) => {
        const projectId = routeRef.current.projectId;
        let count = docsRef.current.filter(d => d.type === 'photo').length;
        const created = [];
        for (const f of files) {
            try {
                const photo = await fileToPhoto(f);
                count++;
                const doc = { ...newPhotoDoc(projectId, `Ảnh ${count}`, photo), createdAt: pb.now(), updatedAt: pb.now() };
                await db.putDoc(doc);
                created.push(doc);
                markDirty('doc', doc);
            } catch (err) {
                console.warn('import photo:', err);
                toast(`Không đọc được ảnh ${f.name}`, 'err');
            }
        }
        if (!created.length) return;
        setDocs(prev => [...prev, ...created]);
        if (created.length === 1) navigate({ screen: 'photo', projectId, docId: created[0].id });
        else toast(`Đã thêm ${created.length} ảnh`, 'ok');
    };

    const renameDoc = async (id, name) => {
        const doc = docsRef.current.find(d => d.id === id);
        if (!doc) return;
        const next = { ...doc, name, updatedAt: pb.now() };
        setDocs(prev => prev.map(d => d.id === id ? next : d));
        await db.putDoc(next);
        markDirty('doc', next);
    };

    const deleteDoc = async (id) => {
        setDocs(prev => prev.filter(d => d.id !== id));
        await db.deleteDoc(id);
        await db.addTombstone(String(id), 'doc', pb.now());
        toast('Đã xóa', 'ok');
        if (pb.isLoggedIn()) syncAll(true);
    };

    // ===== Sync =====
    const syncAll = async (silent) => {
        if (!pb.isLoggedIn()) return;
        if (syncBusyRef.current) { syncAgain.current = true; return; }
        if (navigator.onLine === false) {
            if (!silent) toast('Không có mạng — sẽ tự đồng bộ khi có lại', 'err');
            return;
        }
        syncBusyRef.current = true;
        syncAgain.current = false;
        setSyncBusy(true);
        try {
            // Founder có thể thêm tài khoản vào team SAU khi người dùng đã đăng nhập —
            // dò lại để không phải đăng xuất/đăng nhập mới thấy dữ liệu chung.
            if (!pb.myTeam()) await pb.refreshTeam();
            const [localProjects, localDocs, tombstones, meta] = await Promise.all([
                db.loadProjects(), db.listAllDocs(), db.getTombstones(), db.getMeta(),
            ]);
            const res = await pb.fullSync(
                { projects: localProjects, docs: localDocs, tombstones, scopeDirty: meta.scopeDirty || [] },
                setSyncMsg,
            );

            const delDocSet = new Set(res.deletedDocs.map(String));
            const delProjSet = new Set(res.deletedProjects.map(String));

            // Áp dữ liệu kéo về: đọc-sửa-ghi để không đè lên dự án tạo trong lúc đang sync.
            if (res.pulledProjects.length || delProjSet.size) {
                const next = await persistProjects(cur => {
                    const map = new Map(cur.map(p => [String(p.id), p]));
                    for (const p of res.pulledProjects) map.set(String(p.id), { ...map.get(String(p.id)), ...p });
                    for (const id of delProjSet) map.delete(id);
                    return [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                });
                for (const id of delProjSet) await db.deleteProjectDocs(id);
                projectsRef.current = next;
            }

            // Doc đang có sửa chưa lưu (còn timer) thì KHÔNG ghi đè — bản local mới hơn,
            // lần sync sau sẽ đẩy lên.
            let skippedOpen = 0;
            for (const d of res.pulledDocs) {
                if (saveTimers.current.has(d.id)) { skippedOpen++; continue; }
                await db.putDoc(d);
            }
            for (const id of delDocSet) await db.deleteDoc(id);

            if (res.clearedTombstones.length) await db.removeTombstones(res.clearedTombstones);
            if (res.scopeSynced.length) {
                const done = new Set(res.scopeSynced.map(String));
                // Đọc lại meta: người dùng có thể đổi phạm vi dự án khác trong lúc sync chạy,
                // lọc theo snapshot cũ sẽ xóa mất ý định đó.
                const fresh = await db.getMeta();
                await db.setMeta({ scopeDirty: (fresh.scopeDirty || []).filter(id => !done.has(String(id))) });
            }

            // Chỉ xóa pending cho item đã đẩy được (item lỗi giữ lại để thử tiếp).
            const pending = await db.getPending();
            if (pending.length) {
                const failSet = new Set(res.failedIds);
                const toClear = pending.filter(p => !failSet.has(p.item_id)).map(p => p.item_id);
                await db.clearPending(toClear);
            }

            const at = pb.now();
            setLastSyncAt(at);
            await db.setMeta({ lastSyncAt: at });

            // Làm mới danh sách doc của dự án đang mở, giữ lại bản in-memory của doc đang sửa.
            const r = routeRef.current;
            if (r.projectId && !delProjSet.has(String(r.projectId))) {
                const fresh = await db.listDocs(r.projectId);
                setDocs(fresh.map(d => saveTimers.current.has(d.id)
                    ? (docsRef.current.find(x => x.id === d.id) || d)
                    : d));
            } else if (r.projectId) {
                setDocs([]);
            }

            const pulled = res.pulledProjects.length + res.pulledDocs.length;
            const remoteDels = delDocSet.size + delProjSet.size;
            const changed = pulled + res.pushed + res.deleted + remoteDels;
            const failCount = res.failedIds.length + res.pullFailed.length;
            if (failCount > 0) {
                toast(`Sync: ${res.pushed} đẩy lên, ${pulled} tải về — ${failCount} lỗi, sẽ thử lại`, 'err');
            } else if (changed > 0) {
                const bits = [];
                if (pulled) bits.push(`${pulled} tải về`);
                if (res.pushed) bits.push(`${res.pushed} đẩy lên`);
                if (res.deleted || remoteDels) bits.push(`${res.deleted + remoteDels} xóa`);
                if (!silent || pulled || remoteDels) toast(`Đồng bộ xong: ${bits.join(', ')}`, 'ok');
            } else if (!silent) {
                toast('Dữ liệu đã mới nhất', 'ok');
            }
            // Đẩy lên thành công mà đồng nghiệp vẫn không thấy là kiểu lỗi tệ nhất: không
            // có thông báo nào sai, chỉ có người ngồi chờ dữ liệu không bao giờ tới.
            if (res.orphanTeam?.length) {
                toast(`${res.orphanTeam.length} dự án đã lên cloud nhưng CHƯA gắn team — `
                    + 'đồng nghiệp chưa thấy được. Vào Quản lý team & người dùng để gắn tài khoản vào team.', 'err');
            }
            if (skippedOpen && !silent) toast(`${skippedOpen} file đang sửa — giữ bản trên máy`, 'ok');
            if (res.legacy && !silent) toast('Đang chạy chế độ tương thích — dữ liệu vẫn đúng, chỉ chậm hơn', 'ok');
        } catch (err) {
            if (err.status === 401) {
                setAccount(null); // pb đã xóa phiên — cho chip cloud phản ánh đúng
                toast(err.message, 'err');
            } else if (!silent) toast('Lỗi đồng bộ: ' + err.message, 'err');
            console.warn('sync:', err);
        } finally {
            syncBusyRef.current = false;
            setSyncBusy(false);
            setSyncMsg(null);
            // Có thay đổi chen vào lúc đang sync → chạy thêm một lượt để không bỏ sót.
            if (syncAgain.current) {
                syncAgain.current = false;
                setTimeout(() => syncAll(true), 800);
            }
        }
    };

    const login = async (identity, secret) => {
        try {
            // loginSmart: PIN 4–8 số thì nở thành mật khẩu thật, còn lại coi là mật khẩu
            // thô — nhờ vậy Founder vẫn vào được bằng mật khẩu superuser cũ.
            const user = await pb.loginSmart(identity, secret);
            const sw = await db.setAccount(user.id);
            setAccount(user);
            setProjects(await db.loadProjects());
            const r = routeRef.current;
            setDocs(r.projectId ? await db.listDocs(r.projectId) : []);
            if (sw.adopted) toast('Đã gắn dữ liệu trên máy vào tài khoản này', 'ok');
            else toast('Đăng nhập thành công', 'ok');
            syncAll(true);
        } catch (err) {
            toast(err.message, 'err');
            throw err;
        }
    };

    const logout = () => {
        pb.logout();
        setAccount(null);
        // Giữ nguyên store đang mở — dữ liệu vẫn thấy được trên máy. Chỉ khi một tài
        // khoản KHÁC đăng nhập thì db.setAccount mới đổi sang store riêng của họ.
        toast('Đã đăng xuất — dữ liệu vẫn lưu trên máy');
    };

    // ===== Render =====
    if (share) {
        return (
            <div className="app">
                <ShareViewer code={share.code} data={share.data} decodeError={share.error} />
                <ToastHost />
            </div>
        );
    }

    if (projects === null) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner" />
                <div>Đang tải...</div>
            </div>
        );
    }

    const currentProject = route.projectId ? projects.find(p => p.id === route.projectId) : null;
    const currentDoc = route.docId ? docs.find(d => d.id === route.docId) : null;

    let screen;
    if ((route.screen === 'plan' || route.screen === 'photo') && currentDoc) {
        screen = route.screen === 'plan'
            ? <PlanEditor key={currentDoc.id} doc={currentDoc} onChange={updateDoc} onBack={goBack} />
            : <PhotoEditor key={currentDoc.id} doc={currentDoc} onChange={updateDoc} onBack={goBack} />;
    } else if (route.screen !== 'projects' && currentProject) {
        screen = (
            <ProjectScreen
                project={currentProject}
                docs={docs}
                onBack={goBack}
                onOpenDoc={openDoc}
                onCreatePlan={createPlanDoc}
                onImportPhotos={importPhotos}
                onRenameProject={renameProject}
                onRenameDoc={renameDoc}
                onDeleteDoc={deleteDoc}
            />
        );
    } else {
        screen = (
            <ProjectsScreen
                projects={projects}
                account={account}
                syncBusy={syncBusy}
                syncMsg={syncMsg}
                lastSyncAt={lastSyncAt}
                onOpen={openProject}
                onCreate={createProject}
                onRename={renameProject}
                onDelete={deleteProject}
                onSetScope={setProjectScope}
                onShare={setShareFor}
                onSync={() => syncAll(false)}
                onOpenSyncStatus={() => setShowSyncStatus(true)}
                onOpenTeamAdmin={() => setShowTeamAdmin(true)}
                onLogin={login}
                onLogout={logout}
            />
        );
    }

    return (
        <div className="app">
            {screen}
            <SyncStatusSheet
                open={showSyncStatus}
                onClose={() => setShowSyncStatus(false)}
                onSync={() => { setShowSyncStatus(false); syncAll(false); }}
            />
            <ShareSheet project={shareFor} onClose={() => setShareFor(null)} />
            <TeamAdminSheet open={showTeamAdmin} onClose={() => setShowTeamAdmin(false)} />
            <ToastHost />
        </div>
    );
}
