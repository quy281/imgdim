import React, { useState, useEffect, useRef, useCallback } from 'react';
import ProjectsScreen from './screens/ProjectsScreen';
import ProjectScreen from './screens/ProjectScreen';
import PlanEditor from './screens/PlanEditor';
import PhotoEditor from './screens/PhotoEditor';
import SyncStatusSheet from './ui/SyncStatusSheet';
import ShareViewer from './screens/ShareViewer';
import { ToastHost, toast } from './ui/Toast';
import * as db from './lib/db';
import * as pb from './lib/pb';
import { newProject, newPlanDoc, newPhotoDoc } from './lib/planModel';
import { fileToPhoto, makePlanThumb } from './lib/image';

export default function App() {
    const [projects, setProjects] = useState(null); // null = loading
    const [route, setRoute] = useState({ screen: 'projects' });
    const [docs, setDocs] = useState([]); // docs of the open project
    const [syncBusy, setSyncBusy] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState(null);
    const [showSyncStatus, setShowSyncStatus] = useState(false);
    // share viewer — decode ?view=<b64> từ URL
    const shareData = (() => {
        try {
            const v = new URLSearchParams(window.location.search).get('view');
            if (!v) return null;
            return JSON.parse(atob(v));
        } catch { return null; }
    })();

    const projectsRef = useRef([]);
    useEffect(() => { projectsRef.current = projects || []; }, [projects]);
    const routeRef = useRef(route);
    useEffect(() => { routeRef.current = route; }, [route]);

    const saveTimers = useRef(new Map()); // docId -> timeout
    const syncTimer = useRef(null);       // single debounced sync trigger
    const syncBusyRef = useRef(false);    // guard chống concurrent sync (stale closure)

    // ===== Boot =====
    useEffect(() => {
        (async () => {
            const p = await db.loadProjects();
            setProjects(p);
            if (pb.isLoggedIn()) syncAll(false); // false = hiện lỗi nếu có
        })();
        history.replaceState({ screen: 'projects' }, '');
        const onPop = (e) => setRoute(e.state || { screen: 'projects' });
        window.addEventListener('popstate', onPop);
        const onVisible = () => {
            if (document.visibilityState === 'visible' && pb.isLoggedIn()) syncAll(true);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('popstate', onPop);
            document.removeEventListener('visibilitychange', onVisible);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const navigate = (r) => {
        setRoute(r);
        history.pushState(r, '');
    };
    const goBack = () => history.back();

    // ===== Dirty-flag + debounced sync =====
    // Ghi pending vào IndexedDB ngay (không mất khi app đóng), sau 5s trigger syncAll.
    const markDirty = (kind, item) => {
        db.markPending(item.id, kind);
        if (!pb.isLoggedIn()) return;
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => {
            syncTimer.current = null;
            syncAll(true);
        }, 5000);
    };

    // ===== Projects CRUD =====
    const persistProjects = (list) => {
        setProjects(list);
        db.saveProjects(list);
    };

    const createProject = (name) => {
        const p = newProject(name);
        persistProjects([p, ...projectsRef.current]);
        markDirty('project', p);
        setDocs([]);
        navigate({ screen: 'project', projectId: p.id });
    };

    const renameProject = (id, name) => {
        const list = projectsRef.current.map(p => p.id === id ? { ...p, name, updatedAt: Date.now() } : p);
        persistProjects(list);
        const p = list.find(x => x.id === id);
        if (p) markDirty('project', p);
    };

    const deleteProject = async (id) => {
        const docIds = await db.deleteProjectDocs(id);
        persistProjects(projectsRef.current.filter(p => p.id !== id));
        if (pb.isLoggedIn()) {
            pb.deleteRemote(String(id), 'project').catch(() => db.addTombstone(String(id)));
            for (const docId of docIds) {
                pb.deleteRemote(String(docId), 'doc').catch(() => db.addTombstone(String(docId)));
            }
        }
        toast('Đã xóa dự án', 'ok');
    };

    // ===== Open project / docs =====
    const openProject = async (id) => {
        const list = await db.listDocs(id);
        setDocs(list);
        navigate({ screen: 'project', projectId: id });
    };

    const openDoc = (doc) => {
        navigate({ screen: doc.type === 'plan' ? 'plan' : 'photo', projectId: doc.projectId, docId: doc.id });
    };

    // ===== Doc save (debounced local persist + cloud push) =====
    const updateDoc = useCallback((doc) => {
        setDocs(prev => prev.map(d => d.id === doc.id ? doc : d));
        const timers = saveTimers.current;
        if (timers.has(doc.id)) clearTimeout(timers.get(doc.id));
        timers.set(doc.id, setTimeout(() => {
            timers.delete(doc.id);
            const toSave = doc.type === 'plan' ? { ...doc, thumb: makePlanThumb(doc.plan) } : doc;
            db.putDoc(toSave);
            setDocs(prev => prev.map(d => d.id === toSave.id ? toSave : d));
            markDirty('doc', toSave);
        }, 400));
    }, []);

    const createPlanDoc = async () => {
        const projectId = routeRef.current.projectId;
        const count = docs.filter(d => d.type === 'plan').length + 1;
        const doc = newPlanDoc(projectId, `Mặt bằng ${count}`);
        await db.putDoc(doc);
        setDocs(prev => [...prev, doc]);
        markDirty('doc', doc);
        navigate({ screen: 'plan', projectId, docId: doc.id });
    };

    const importPhotos = async (files) => {
        const projectId = routeRef.current.projectId;
        let count = docs.filter(d => d.type === 'photo').length;
        const created = [];
        for (const f of files) {
            try {
                const photo = await fileToPhoto(f);
                count++;
                const doc = newPhotoDoc(projectId, `Ảnh ${count}`, photo);
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
        if (created.length === 1) {
            navigate({ screen: 'photo', projectId, docId: created[0].id });
        } else {
            toast(`Đã thêm ${created.length} ảnh`, 'ok');
        }
    };

    const renameDoc = async (id, name) => {
        const doc = docs.find(d => d.id === id);
        if (!doc) return;
        const next = { ...doc, name, updatedAt: Date.now() };
        setDocs(prev => prev.map(d => d.id === id ? next : d));
        await db.putDoc(next);
        markDirty('doc', next);
    };

    const deleteDoc = async (id) => {
        const doc = docs.find(d => d.id === id);
        setDocs(prev => prev.filter(d => d.id !== id));
        await db.deleteDoc(id);
        if (pb.isLoggedIn()) {
            pb.deleteRemote(String(id), 'doc').catch(() => db.addTombstone(String(id)));
        }
        toast('Đã xóa', 'ok');
    };

    // ===== Cloud sync =====
    const syncAll = async (silent) => {
        if (!pb.isLoggedIn() || syncBusyRef.current) return;
        syncBusyRef.current = true;
        setSyncBusy(true);
        try {
            const [localProjects, localDocs, tombstones] = await Promise.all([
                db.loadProjects(), db.listAllDocs(), db.getTombstones(),
            ]);
            const res = await pb.fullSync({ projects: localProjects, docs: localDocs, tombstones });
            // apply pulled + deleted data locally
            const delDocSet = new Set((res.deletedDocs || []).map(String));
            const delProjSet = new Set((res.deletedProjects || []).map(String));
            const needsProjUpdate = res.pulledProjects.length > 0 || delProjSet.size > 0;
            if (needsProjUpdate) {
                const map = new Map(localProjects.map(p => [String(p.id), p]));
                for (const p of res.pulledProjects) map.set(String(p.id), p);
                for (const id of delProjSet) { map.delete(id); await db.deleteProjectDocs(id); }
                const merged = [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                await db.saveProjects(merged);
                setProjects(merged);
            }
            for (const d of res.pulledDocs) await db.putDoc(d);
            for (const id of delDocSet) await db.deleteDoc(id);
            if (res.clearedTombstones.length) await db.removeTombstones(res.clearedTombstones);
            // clear pending — chỉ xóa item đã push thành công (không xóa item bị lỗi)
            const pending = await db.getPending();
            if (pending.length) {
                const failSet = new Set(res.failedIds || []);
                const toClear = pending.filter(p => !failSet.has(p.item_id)).map(p => p.item_id);
                if (toClear.length) await db.clearPending(toClear);
            }
            setLastSyncAt(Date.now());
            // refresh open project view
            const r = routeRef.current;
            if (r.projectId) {
                if (delProjSet.has(String(r.projectId))) setDocs([]);
                else setDocs(await db.listDocs(r.projectId));
            }
            const remoteDels = delDocSet.size + delProjSet.size;
            const changed = res.pulledProjects.length + res.pulledDocs.length + res.pushed + res.deleted + remoteDels;
            const failCount = res.failedIds?.length || 0;
            if (!silent || changed > 0 || failCount > 0) {
                if (failCount > 0)
                    toast(`Sync: ${res.pushed} đẩy lên, ${res.pulledProjects.length + res.pulledDocs.length} tải về — ${failCount} lỗi`, 'err');
                else if (changed > 0)
                    toast(`Đồng bộ xong: ${res.pulledProjects.length + res.pulledDocs.length} tải về, ${res.pushed} đẩy lên`, 'ok');
                else if (!silent)
                    toast('Dữ liệu đã mới nhất', 'ok');
            }
        } catch (err) {
            if (!silent) toast('Lỗi đồng bộ: ' + err.message, 'err');
            else toast('Sync thất bại — kiểm tra mạng', 'err');
            console.warn('sync:', err);
        } finally {
            syncBusyRef.current = false;
            setSyncBusy(false);
        }
    };

    const login = async (email, password) => {
        try {
            await pb.login(email, password);
            toast('Đăng nhập thành công', 'ok');
            syncAll(true);
        } catch (err) {
            toast(err.message, 'err');
            throw err;
        }
    };

    const logout = () => {
        pb.logout();
        toast('Đã đăng xuất — dữ liệu vẫn lưu trên máy');
        setProjects(p => [...(p || [])]); // re-render header chip
    };

    // ===== Render =====
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
                syncBusy={syncBusy}
                lastSyncAt={lastSyncAt}
                onOpen={openProject}
                onCreate={createProject}
                onRename={renameProject}
                onDelete={deleteProject}
                onSync={() => syncAll(false)}
                onOpenSyncStatus={() => setShowSyncStatus(true)}
                onLogin={login}
                onLogout={logout}
            />
        );
    }

    if (shareData) return (
        <div className="app">
            <ShareViewer data={shareData} />
            <ToastHost />
        </div>
    );

    return (
        <div className="app">
            {screen}
            <SyncStatusSheet
                open={showSyncStatus}
                onClose={() => setShowSyncStatus(false)}
                onSync={() => { setShowSyncStatus(false); syncAll(false); }}
            />
            <ToastHost />
        </div>
    );
}
