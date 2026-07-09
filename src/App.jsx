import React, { useState, useEffect, useRef, useCallback } from 'react';
import ProjectsScreen from './screens/ProjectsScreen';
import ProjectScreen from './screens/ProjectScreen';
import PlanEditor from './screens/PlanEditor';
import PhotoEditor from './screens/PhotoEditor';
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

    const projectsRef = useRef([]);
    useEffect(() => { projectsRef.current = projects || []; }, [projects]);
    const routeRef = useRef(route);
    useEffect(() => { routeRef.current = route; }, [route]);

    const saveTimers = useRef(new Map()); // docId -> timeout
    const pushTimers = useRef(new Map()); // itemId -> timeout

    // ===== Boot =====
    useEffect(() => {
        (async () => {
            const p = await db.loadProjects();
            setProjects(p);
            if (pb.isLoggedIn()) syncAll(true);
        })();
        history.replaceState({ screen: 'projects' }, '');
        const onPop = (e) => setRoute(e.state || { screen: 'projects' });
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const navigate = (r) => {
        setRoute(r);
        history.pushState(r, '');
    };
    const goBack = () => history.back();

    // ===== Auto-push to cloud (debounced per item) =====
    const schedulePush = (kind, item) => {
        if (!pb.isLoggedIn()) return;
        const key = String(item.id);
        const timers = pushTimers.current;
        if (timers.has(key)) clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            pb.pushItem(kind, item).catch(err => console.warn('auto-push:', err.message));
        }, 4000));
    };

    // ===== Projects CRUD =====
    const persistProjects = (list) => {
        setProjects(list);
        db.saveProjects(list);
    };

    const createProject = (name) => {
        const p = newProject(name);
        persistProjects([p, ...projectsRef.current]);
        schedulePush('project', p);
        setDocs([]);
        navigate({ screen: 'project', projectId: p.id });
    };

    const renameProject = (id, name) => {
        const list = projectsRef.current.map(p => p.id === id ? { ...p, name, updatedAt: Date.now() } : p);
        persistProjects(list);
        const p = list.find(x => x.id === id);
        if (p) schedulePush('project', p);
    };

    const deleteProject = async (id) => {
        const docIds = await db.deleteProjectDocs(id);
        persistProjects(projectsRef.current.filter(p => p.id !== id));
        const allIds = [id, ...docIds];
        for (const itemId of allIds) {
            await db.addTombstone(String(itemId));
            if (pb.isLoggedIn()) {
                pb.deleteRemote(String(itemId))
                    .then(() => db.removeTombstones([String(itemId)]))
                    .catch(() => { /* fullSync will retry */ });
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
            schedulePush('doc', toSave);
        }, 400));
    }, []);

    const createPlanDoc = async () => {
        const projectId = routeRef.current.projectId;
        const count = docs.filter(d => d.type === 'plan').length + 1;
        const doc = newPlanDoc(projectId, `Mặt bằng ${count}`);
        await db.putDoc(doc);
        setDocs(prev => [...prev, doc]);
        schedulePush('doc', doc);
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
                schedulePush('doc', doc);
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
        schedulePush('doc', next);
    };

    const deleteDoc = async (id) => {
        setDocs(prev => prev.filter(d => d.id !== id));
        await db.deleteDoc(id);
        await db.addTombstone(String(id));
        if (pb.isLoggedIn()) {
            pb.deleteRemote(String(id))
                .then(() => db.removeTombstones([String(id)]))
                .catch(() => { /* fullSync will retry */ });
        }
        toast('Đã xóa', 'ok');
    };

    // ===== Cloud sync =====
    const syncAll = async (silent) => {
        if (!pb.isLoggedIn() || syncBusy) return;
        setSyncBusy(true);
        try {
            const [localProjects, localDocs, tombstones] = await Promise.all([
                db.loadProjects(), db.listAllDocs(), db.getTombstones(),
            ]);
            const res = await pb.fullSync({ projects: localProjects, docs: localDocs, tombstones });
            // apply pulled data locally
            if (res.pulledProjects.length) {
                const map = new Map(localProjects.map(p => [String(p.id), p]));
                for (const p of res.pulledProjects) map.set(String(p.id), p);
                const merged = [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                await db.saveProjects(merged);
                setProjects(merged);
            }
            for (const d of res.pulledDocs) await db.putDoc(d);
            if (res.clearedTombstones.length) await db.removeTombstones(res.clearedTombstones);
            // refresh open project view
            const r = routeRef.current;
            if (r.projectId) setDocs(await db.listDocs(r.projectId));
            const changed = res.pulledProjects.length + res.pulledDocs.length + res.pushed + res.deleted;
            if (!silent || changed > 0) {
                toast(changed > 0
                    ? `Đồng bộ xong: ${res.pulledProjects.length + res.pulledDocs.length} tải về, ${res.pushed} đẩy lên`
                    : 'Dữ liệu đã mới nhất', 'ok');
            }
        } catch (err) {
            if (!silent) toast('Lỗi đồng bộ: ' + err.message, 'err');
            console.warn('sync:', err);
        } finally {
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
                onOpen={openProject}
                onCreate={createProject}
                onRename={renameProject}
                onDelete={deleteProject}
                onSync={() => syncAll(false)}
                onLogin={login}
                onLogout={logout}
            />
        );
    }

    return (
        <div className="app">
            {screen}
            <ToastHost />
        </div>
    );
}
