import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line as KonvaLine, Rect as KonvaRect, Text, Group } from 'react-konva';
import { ImagePlus, Download, PencilRuler, Frame, Stamp, SaveAll, Unlock, Lock, Camera, Images, X, Share2, Wand2, Edit3, Trash2, Type, ArrowLeft, Crown } from 'lucide-react';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import DimensionLine from './components/DimensionLine';
import FrameOverlay from './components/FrameOverlay';
import TextNote from './components/TextNote';
import ProjectList from './components/ProjectList';
import UpgradeModal from './components/UpgradeModal';
import PricingPage from './components/PricingPage';
import AuthPage from './components/AuthPage';
import SettingsPage from './components/SettingsPage';
import { useTier } from './TierContext';
import * as GDrive from './googleDriveService';
import { loadProjects, saveProjects, loadDocs, saveDocs, deleteProjectDocs } from './db';
import './App.css';

export default function App() {
  // === Project state ===
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [loadingDB, setLoadingDB] = useState(true);

  // === Doc/Editor state ===
  const [docs, setDocs] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [copiedLine, setCopiedLine] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isTextMode, setIsTextMode] = useState(false);
  const [tempLine, setTempLine] = useState(null);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [showFrame, setShowFrame] = useState(false);
  const [isEditFrameMode, setIsEditFrameMode] = useState(false);
  const [customFrame, setCustomFrame] = useState(null);
  const [watermarkTxt, setWatermarkTxt] = useState('');
  const [customWatermark, setCustomWatermark] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showMobileHistory, setShowMobileHistory] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { canUse, requireFeature, limits, showUpgrade, upgradeFeature, dismissUpgrade, currentTier, setCurrentTier, user, setUser, logout } = useTier();

  const mainAreaRef = useRef();
  const stageRef = useRef();
  const currentDoc = docs.find(d => d.id === activeDocId);
  const saveTimeoutRef = useRef(null);
  const lastTouchDistRef = useRef(null);
  const lastTouchCenterRef = useRef(null);

  // === Load projects on mount ===
  useEffect(() => {
    (async () => {
      const p = await loadProjects();
      setProjects(p);
      // Auto-open most recent project (collection view, not a specific photo)
      if (p.length > 0) {
        const sorted = [...p].sort((a, b) => b.createdAt - a.createdAt);
        setCurrentProjectId(sorted[0].id);
      }
      setLoadingDB(false);
    })();
  }, []);

  // === Android back button ===
  useEffect(() => {
    const handler = CapApp.addListener('backButton', () => {
      if (showMobileHistory) {
        setShowMobileHistory(false);
      } else if (activeDocId) {
        setActiveDocId(null);
      } else if (currentProjectId) {
        setCurrentProjectId(null);
      } else {
        CapApp.exitApp();
      }
    });
    return () => { handler.then(h => h.remove()); };
  }, [showMobileHistory, activeDocId, currentProjectId]);

  // === Load docs when project changes ===
  useEffect(() => {
    if (!currentProjectId) { setDocs([]); setActiveDocId(null); return; }
    (async () => {
      const raw = await loadDocs(currentProjectId);
      // Reconstruct Image objects from base64
      const hydrated = await Promise.all(raw.map(d => new Promise(resolve => {
        if (!d.imgBase64) { resolve({ ...d, img: null }); return; }
        const image = new window.Image();
        image.onload = () => resolve({ ...d, img: image });
        image.onerror = () => resolve({ ...d, img: null });
        image.src = d.imgBase64;
      })));
      setDocs(hydrated.filter(d => d.img));
      // Don't auto-open a doc; show gallery view instead
      setActiveDocId(null);
    })();
  }, [currentProjectId]);

  // === Auto-save docs (debounced) ===
  const scheduleSave = useCallback(() => {
    if (!currentProjectId) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => { saveDocs(currentProjectId, docs); }, 500);
  }, [currentProjectId, docs]);

  useEffect(() => { scheduleSave(); }, [docs, scheduleSave]);

  // === Resize ===
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const updateSize = () => { if (mainAreaRef.current) setStageSize({ width: mainAreaRef.current.offsetWidth, height: mainAreaRef.current.offsetHeight }); };
    window.addEventListener('resize', updateSize);
    updateSize(); return () => window.removeEventListener('resize', updateSize);
  }, []);

  // === Doc helpers ===
  const updateDoc = (updates) => {
    setDocs(prev => prev.map(d => d.id === activeDocId ? { ...d, ...updates } : d));
  };

  const commitHistory = (newLines, newTexts) => {
    setDocs(prev => prev.map(d => {
      if (d.id !== activeDocId) return d;
      const history = d.linesHistory.slice(0, d.historyStep + 1);
      const textsHistory = (d.textsHistory || [[]]).slice(0, d.historyStep + 1);
      const lines = newLines !== undefined ? newLines : d.lines;
      const texts = newTexts !== undefined ? newTexts : (d.texts || []);
      history.push(lines);
      textsHistory.push(texts);
      return { ...d, lines, texts, linesHistory: history, textsHistory, historyStep: history.length - 1 };
    }));
  };

  // === Keyboard shortcuts ===
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!currentDoc) return;
      if (e.key === 'Escape') { setIsDrawingMode(false); setIsTextMode(false); setSelectedId(null); setIsEditFrameMode(false); document.body.style.cursor = 'default'; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null && !isEditFrameMode) {
        const isLine = currentDoc.lines.some(l => l.id === selectedId);
        if (isLine) commitHistory(currentDoc.lines.filter(l => l.id !== selectedId), currentDoc.texts || []);
        else commitHistory(currentDoc.lines, (currentDoc.texts || []).filter(t => t.id !== selectedId));
        setSelectedId(null);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        if (currentDoc.historyStep > 0) {
          const s = currentDoc.historyStep - 1;
          updateDoc({ lines: currentDoc.linesHistory[s], texts: (currentDoc.textsHistory || [[]])[s] || [], historyStep: s });
          setSelectedId(null);
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        if (currentDoc.historyStep < currentDoc.linesHistory.length - 1) {
          const s = currentDoc.historyStep + 1;
          updateDoc({ lines: currentDoc.linesHistory[s], texts: (currentDoc.textsHistory || [[]])[s] || [], historyStep: s });
          setSelectedId(null);
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'c' && selectedId !== null) {
        const line = currentDoc.lines.find(l => l.id === selectedId);
        if (line) setCopiedLine(line);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'v' && copiedLine) {
        const off = 40 / currentDoc.stageScale;
        const nl = { ...copiedLine, id: Date.now(), start: { x: copiedLine.start.x + off, y: copiedLine.start.y + off }, end: { x: copiedLine.end.x + off, y: copiedLine.end.y + off } };
        commitHistory([...currentDoc.lines, nl], currentDoc.texts || []);
        setSelectedId(nl.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDoc, selectedId, isEditFrameMode, copiedLine]);

  // === Frame / watermark helpers ===
  const initFrameAttrs = (baseImg, overlayImg) => {
    const scale = Math.min(baseImg.width / overlayImg.width, baseImg.height / overlayImg.height);
    const fw = overlayImg.width * scale; const fh = overlayImg.height * scale;
    return { x: (baseImg.width - fw) / 2, y: (baseImg.height - fh) / 2, width: fw, height: fh };
  };

  const handleUpload = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = ''; // Reset so same file can be selected again
    if (!files.length) return;
    // Enforce photo limit
    const currentCount = docs.length;
    const maxPhotos = limits.maxPhotosPerProject;
    if (currentCount >= maxPhotos) {
      alert(`Đã đạt giới hạn ${maxPhotos} ảnh/dự án. Nâng cấp để thêm!`);
      return;
    }
    const allowedFiles = files.slice(0, maxPhotos - currentCount);
    allowedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result;
        const image = new window.Image(); image.src = base64;
        image.onload = () => {
          const w = mainAreaRef.current ? mainAreaRef.current.offsetWidth : window.innerWidth;
          const h = mainAreaRef.current ? mainAreaRef.current.offsetHeight : window.innerHeight - 150;
          const pad = isMobile ? 10 : 100;
          const autoScale = isMobile
            ? Math.min(w / image.width, h / image.height)
            : Math.min((w - pad) / image.width, (h - pad) / image.height, 1);
          const newDoc = {
            id: Date.now() + Math.random(), name: file.name, img: image, imgBase64: base64,
            lines: [], texts: [], linesHistory: [[]], textsHistory: [[]], historyStep: 0,
            globalRatio: null,
            frameAttrs: customFrame ? initFrameAttrs(image, customFrame) : null,
            stageScale: autoScale,
            stagePos: { x: (w - image.width * autoScale) / 2, y: (h - image.height * autoScale) / 2 + 20 }
          };
          setDocs(prev => [...prev, newDoc]);
          // Stay in gallery view (don't auto-open editor)
          // Update project doc count
          setProjects(prev => {
            const updated = prev.map(p => p.id === currentProjectId ? { ...p, docCount: (p.docCount || 0) + 1 } : p);
            saveProjects(updated);
            return updated;
          });
          // Auto-upload original photo to Google Drive
          if (GDrive.isConnected() && localStorage.getItem('gdrive_auto_upload') === 'true') {
            try {
              const b64 = base64.split(',')[1];
              const projectName = projects.find(p => p.id === currentProjectId)?.name || '';
              GDrive.uploadImage(b64, file.name, projectName).catch(err => console.warn('GDrive upload:', err));
            } catch (err) { console.warn('GDrive upload error:', err); }
          }
        };
      };
      reader.readAsDataURL(file);
    });
    if (showMobileHistory) setShowMobileHistory(false);
  };

  const handleUploadCustomFrame = (e) => {
    if (!requireFeature('customFrame')) { e.target.value = ''; return; }
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const image = new window.Image(); image.src = reader.result; image.onload = () => { setCustomFrame(image); setShowFrame(true); setDocs(prev => prev.map(d => ({ ...d, frameAttrs: initFrameAttrs(d.img, image) }))); }; };
    reader.readAsDataURL(file);
  };

  const handleUploadCustomWatermark = (e) => {
    if (!requireFeature('customWatermark')) { e.target.value = ''; return; }
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const image = new window.Image(); image.src = reader.result; image.onload = () => setCustomWatermark(image); };
    reader.readAsDataURL(file);
  };

  // === Text / Dim edit ===
  const handleTextEdit = (line) => {
    const userInput = prompt("Nhập kích thước thực tế (VD: 800, 5000):", line.label);
    if (userInput !== null) {
      const val = parseFloat(userInput);
      const dx = line.end.x - line.start.x; const dy = line.end.y - line.start.y;
      const pxDist = Math.sqrt(dx * dx + dy * dy);
      const newLines = currentDoc.lines.map(l => l.id === line.id ? { ...l, label: userInput } : l);
      if (!isNaN(val) && pxDist > 0) updateDoc({ globalRatio: val / pxDist });
      commitHistory(newLines, currentDoc.texts || []);
    }
  };

  const handleTextNoteEdit = (note) => {
    const txt = prompt("Nhập ghi chú:", note.text);
    if (txt !== null && txt.trim()) {
      const newTexts = (currentDoc.texts || []).map(t => t.id === note.id ? { ...t, text: txt.trim() } : t);
      commitHistory(currentDoc.lines, newTexts);
    }
  };

  // === Stage interaction ===
  const handleWheel = (e) => {
    if (!currentDoc) return;
    e.evt.preventDefault();
    const scaleBy = 1.1; const stage = stageRef.current;
    const oldScale = stage.scaleX(); const pointer = stage.getPointerPosition();
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    updateDoc({ stageScale: newScale, stagePos: { x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale } });
  };

  const getPointerPos = (e) => {
    const stage = stageRef.current; if (!stage) return null;
    if (e.evt?.touches?.length > 0) { const t = e.evt.touches[0]; const r = stage.container().getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }
    if (e.evt?.changedTouches?.length > 0) { const t = e.evt.changedTouches[0]; const r = stage.container().getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }
    return stage.getPointerPosition();
  };

  const getTouchDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touches, rect) => {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
      y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top
    };
  };

  const handleStageMouseDown = (e) => {
    if (isEditFrameMode) return;
    // Pinch zoom start: 2 fingers
    if (e.evt?.touches?.length === 2) {
      if (e.evt.cancelable) e.evt.preventDefault();
      lastTouchDistRef.current = getTouchDist(e.evt.touches);
      const rect = stageRef.current.container().getBoundingClientRect();
      lastTouchCenterRef.current = getTouchCenter(e.evt.touches, rect);
      return;
    }
    if (e.target.name() === 'handle' || e.target.name() === 'dim-group') return;

    // Text mode: place text on click
    if (isTextMode) {
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
      const stage = stageRef.current; const pos = getPointerPos(e); if (!pos) return;
      const x = (pos.x - stage.x()) / stage.scaleX();
      const y = (pos.y - stage.y()) / stage.scaleY();
      const txt = prompt("Nhập ghi chú:");
      if (txt && txt.trim()) {
        const newNote = { id: Date.now(), x, y, text: txt.trim(), color: '#ffffff', fontSize: 16 };
        commitHistory(currentDoc.lines, [...(currentDoc.texts || []), newNote]);
        setSelectedId(newNote.id);
      }
      return;
    }

    if (!isDrawingMode) { if (e.target === e.target.getStage() || e.target.className === 'Image') setSelectedId(null); return; }
    if (e.evt && e.evt.cancelable) e.evt.preventDefault();
    const stage = stageRef.current; const pos = getPointerPos(e); if (!pos) return;
    const x = (pos.x - stage.x()) / stage.scaleX();
    const y = (pos.y - stage.y()) / stage.scaleY();
    setTempLine({ start: { x, y }, end: { x, y } });
  };

  const handleStageMouseMove = (e) => {
    // Pinch zoom move: 2 fingers
    if (e.evt?.touches?.length === 2 && lastTouchDistRef.current !== null) {
      if (e.evt.cancelable) e.evt.preventDefault();
      const stage = stageRef.current;
      const newDist = getTouchDist(e.evt.touches);
      const rect = stage.container().getBoundingClientRect();
      const newCenter = getTouchCenter(e.evt.touches, rect);
      const oldScale = currentDoc.stageScale;
      const scale = oldScale * (newDist / lastTouchDistRef.current);
      // Zoom toward pinch center
      const pointTo = { x: (newCenter.x - stage.x()) / oldScale, y: (newCenter.y - stage.y()) / oldScale };
      // Pan offset
      const dx = newCenter.x - lastTouchCenterRef.current.x;
      const dy = newCenter.y - lastTouchCenterRef.current.y;
      updateDoc({
        stageScale: scale,
        stagePos: {
          x: newCenter.x - pointTo.x * scale + dx,
          y: newCenter.y - pointTo.y * scale + dy
        }
      });
      lastTouchDistRef.current = newDist;
      lastTouchCenterRef.current = newCenter;
      return;
    }
    if (!isDrawingMode || !tempLine || isEditFrameMode) return;
    if (e.evt && e.evt.cancelable) e.evt.preventDefault();
    const stage = stageRef.current; const pos = getPointerPos(e); if (!pos) return;
    let x = (pos.x - stage.x()) / stage.scaleX();
    let y = (pos.y - stage.y()) / stage.scaleY();
    if (e.evt && e.evt.shiftKey) {
      const dx = x - tempLine.start.x; const dy = y - tempLine.start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      x = tempLine.start.x + Math.cos(angle) * distance;
      y = tempLine.start.y + Math.sin(angle) * distance;
    }
    setTempLine({ ...tempLine, end: { x, y } });
  };

  const handleStageMouseUp = () => {
    // Reset pinch state
    lastTouchDistRef.current = null;
    lastTouchCenterRef.current = null;
    if (!isDrawingMode || !tempLine || isEditFrameMode) return;
    const dx = tempLine.end.x - tempLine.start.x; const dy = tempLine.end.y - tempLine.start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 10) {
      let labelVal = Math.round(distance).toString();
      if (currentDoc.globalRatio) { let rv = distance * currentDoc.globalRatio; rv = Math.round(rv / 10) * 10; labelVal = rv.toString(); }
      const newLine = { id: Date.now(), start: tempLine.start, end: tempLine.end, label: labelVal };
      commitHistory([...currentDoc.lines, newLine], currentDoc.texts || []);
      setSelectedId(newLine.id);
    }
    setTempLine(null);
  };

  const handleMagicDim = () => {
    if (!currentDoc || !currentDoc.img) return;
    if (!requireFeature('magicDim')) return;
    const w = currentDoc.img.width; const h = currentDoc.img.height;
    const pad = Math.min(w, h) * 0.05;
    const newLines = [
      { id: Date.now() + Math.random(), start: { x: pad, y: pad }, end: { x: w - pad, y: pad }, label: Math.round(w - 2 * pad).toString(), isMagic: true },
      { id: Date.now() + Math.random(), start: { x: pad, y: pad }, end: { x: pad, y: h - pad }, label: Math.round(h - 2 * pad).toString(), isMagic: true },
      { id: Date.now() + Math.random(), start: { x: pad, y: h - pad }, end: { x: w - pad, y: h - pad }, label: Math.round(w - 2 * pad).toString(), isMagic: true },
      { id: Date.now() + Math.random(), start: { x: w - pad, y: pad }, end: { x: w - pad, y: h - pad }, label: Math.round(h - 2 * pad).toString(), isMagic: true }
    ];
    requestAnimationFrame(() => {
      const nonMagic = currentDoc.lines.filter(l => !l.isMagic);
      commitHistory([...nonMagic, ...newLines], currentDoc.texts || []);
    });
  };

  // === Export / Share ===
  const getExportURI = (doc) => {
    const stage = stageRef.current;
    const oldScale = stage.scaleX(); const oldPos = stage.position();
    stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 });
    let cropBox = { x: 0, y: 0, width: doc.img.width, height: doc.img.height };
    if (showFrame && customFrame && doc.frameAttrs) cropBox = { x: doc.frameAttrs.x, y: doc.frameAttrs.y, width: doc.frameAttrs.width, height: doc.frameAttrs.height };
    const uri = stage.toDataURL({ pixelRatio: 1, ...cropBox });
    stage.scale({ x: oldScale, y: oldScale }); stage.position(oldPos);
    return uri;
  };

  const executeDownload = async (doc, isBatch = false) => {
    setSelectedId(null); setIsEditFrameMode(false);
    return new Promise(resolve => {
      setTimeout(async () => {
        try {
          const uri = getExportURI(doc);
          if (Capacitor.isNativePlatform()) {
            // Ensure filesystem permissions
            let permStatus = await Filesystem.checkPermissions();
            if (permStatus.publicStorage !== 'granted') {
              permStatus = await Filesystem.requestPermissions();
              if (permStatus.publicStorage !== 'granted') {
                if (!isBatch) alert('Cần cấp quyền lưu trữ để lưu ảnh!');
                resolve(); return;
              }
            }
            const base64Data = uri.split(',')[1];
            const fileName = `DIM_${doc.name.replace(/\.[^/.]+$/, "")}_${Date.now()}.png`;
            await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Documents, recursive: true });
            // Auto-upload to Google Drive if connected
            if (GDrive.isConnected() && localStorage.getItem('gdrive_auto_upload') === 'true') {
              try {
                const projectName = projects.find(p => p.id === currentProjectId)?.name || '';
                await GDrive.uploadImage(base64Data, fileName, projectName);
              } catch (driveErr) { console.warn('GDrive upload failed:', driveErr); }
            }
            if (!isBatch) alert("Lưu thành công ảnh vào thư mục Documents!");
          } else {
            const link = document.createElement('a'); link.download = `[DIM]_${doc.name}`; link.href = uri; link.click();
            // Auto-upload to Google Drive for web too
            if (GDrive.isConnected() && localStorage.getItem('gdrive_auto_upload') === 'true') {
              try {
                const base64Data = uri.split(',')[1];
                const projectName = projects.find(p => p.id === currentProjectId)?.name || '';
                await GDrive.uploadImage(base64Data, `[DIM]_${doc.name}`, projectName);
              } catch (driveErr) { console.warn('GDrive upload failed:', driveErr); }
            }
          }
        } catch (err) { if (!isBatch) alert("Lỗi lưu ảnh: " + err.message); }
        resolve();
      }, 100);
    });
  };

  const handleShare = async (doc) => {
    setSelectedId(null); setIsEditFrameMode(false);
    setTimeout(async () => {
      try {
        // Ensure filesystem permissions
        let permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== 'granted') {
          permStatus = await Filesystem.requestPermissions();
        }
        const uri = getExportURI(doc);
        const base64Data = uri.split(',')[1];
        const fileName = `DIM_${doc.name.replace(/\.[^/.]+$/, "")}_${Date.now()}.png`;
        const savedFile = await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Cache });
        await Share.share({ title: 'Chia sẻ bản vẽ DIM', url: savedFile.uri, dialogTitle: 'Chia sẻ bản vẽ DIM' });
      } catch (err) { alert("Không thể chia sẻ ảnh: " + err.message); }
    }, 100);
  };

  const handleBatchExport = async () => {
    if (docs.length === 0) return;
    if (!requireFeature('batchExport')) return;
    setIsExportingAll(true); setSelectedId(null); setIsEditFrameMode(false);
    for (let i = 0; i < docs.length; i++) {
      setActiveDocId(docs[i].id);
      await new Promise(resolve => setTimeout(resolve, 300));
      await executeDownload(docs[i], true);
    }
    setIsExportingAll(false);
    if (Capacitor.isNativePlatform()) alert("Đã lưu xong toàn bộ ảnh vào thư mục Documents!");
  };

  // === Project CRUD ===
  const handleCreateProject = (name) => {
    const p = { id: Date.now(), name, createdAt: Date.now(), docCount: 0 };
    const updated = [p, ...projects];
    setProjects(updated);
    saveProjects(updated);
    setCurrentProjectId(p.id);
  };

  const handleDeleteProject = (id) => {
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    saveProjects(updated);
    deleteProjectDocs(id);
    if (currentProjectId === id) { setCurrentProjectId(null); setDocs([]); setActiveDocId(null); }
  };

  const handleRenameProject = (id, newName) => {
    const updated = projects.map(p => p.id === id ? { ...p, name: newName } : p);
    setProjects(updated);
    saveProjects(updated);
  };

  // === Loading ===
  if (loadingDB) return <div className="loading-screen"><div className="loading-spinner" /><p>Đang tải...</p></div>;

  // === Pricing page ===
  if (showPricing) {
    return <PricingPage currentTier={currentTier} onBack={() => setShowPricing(false)} onSelectTier={(tier) => { setCurrentTier(tier); setShowPricing(false); }} />;
  }

  // === Auth page ===
  if (showAuth) {
    return <AuthPage onBack={() => setShowAuth(false)} user={user} onLogin={(u) => { setUser(u); setShowAuth(false); }} onLogout={() => { logout(); setShowAuth(false); }} currentTier={currentTier} />;
  }

  // === Settings page ===
  if (showSettings) {
    return <SettingsPage onBack={() => setShowSettings(false)} />;
  }

  // === Project list view ===
  if (!currentProjectId) {
    return <ProjectList projects={projects} onOpenProject={setCurrentProjectId} onCreateProject={handleCreateProject} onDeleteProject={handleDeleteProject} onRenameProject={handleRenameProject} onShowPricing={() => setShowPricing(true)} currentTier={currentTier} maxProjects={limits.maxProjects} onShowAuth={() => setShowAuth(true)} user={user} onShowSettings={() => setShowSettings(true)} />;
  }

  // === Editor view ===
  const currentProject = projects.find(p => p.id === currentProjectId);

  return (
    <div className={`app-wrapper ${isMobile ? 'mobile-layout' : 'desktop-layout'}`}>
      {!isMobile && (
        <div className="sidebar">
          <div style={{ padding: '10px 15px', borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-icon" onClick={() => setCurrentProjectId(null)} style={{ padding: 4 }}><ArrowLeft size={18} /></button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 'bold', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentProject?.name}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{docs.length} ảnh</div>
            </div>
          </div>
          <div className="thumb-list">
            {docs.map(doc => (
              <div key={doc.id} className={`thumb-item ${doc.id === activeDocId ? 'active' : ''}`} onClick={() => setActiveDocId(doc.id)}>
                <img src={doc.img.src} alt="thumb" />
                <div className="thumb-name">{doc.name}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '15px', borderTop: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="file-input-wrapper">
              <button className="btn btn-primary w-full" style={{ justifyContent: 'center', width: '100%' }}><ImagePlus size={18} /> Thêm ảnh</button>
              <input type="file" multiple onChange={handleUpload} accept="image/*" />
            </div>
            <button className="btn" onClick={handleBatchExport} disabled={docs.length === 0 || isExportingAll} style={{ justifyContent: 'center', width: '100%', color: canUse('batchExport') ? '#059669' : '#94a3b8', background: canUse('batchExport') ? '#ecfdf5' : '#f1f5f9', border: `1px solid ${canUse('batchExport') ? '#34d399' : '#e2e8f0'}` }}>
              {!canUse('batchExport') && <Crown size={14} color="#eab308" />}
              <SaveAll size={18} /> {isExportingAll ? 'Đang xuất...' : 'Xuất Toàn Bộ'}
            </button>
          </div>
          <div style={{ padding: '15px', borderTop: '1px solid #ddd', background: '#f8fafc' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#475569' }}>Cài đặt</div>
            <div className="file-input-wrapper" style={{ marginBottom: '8px' }}>
              <button className="btn w-full" style={{ justifyContent: 'center', width: '100%', border: '1px dashed #cbd5e1', fontSize: '12px' }}>Tải Khung (PNG)</button>
              <input type="file" accept="image/png" onChange={handleUploadCustomFrame} />
            </div>
            <div className="file-input-wrapper" style={{ marginBottom: '8px' }}>
              <button className="btn w-full" style={{ justifyContent: 'center', width: '100%', border: '1px dashed #cbd5e1', fontSize: '12px' }}>Tải Watermark (PNG)</button>
              <input type="file" accept="image/png" onChange={handleUploadCustomWatermark} />
            </div>
            {!customWatermark && (
              <button className="btn w-full" onClick={() => { const txt = prompt("Nhập Chữ Watermark:", watermarkTxt); if (txt !== null) setWatermarkTxt(txt); }} style={{ justifyContent: 'center', width: '100%', border: '1px dashed #cbd5e1', fontSize: '12px' }}>
                <Stamp size={14} /> Điền Chữ Watermark
              </button>
            )}
          </div>
        </div>
      )}

      <div className="main-area" ref={mainAreaRef}>
        {!isMobile && currentDoc && (
          <div className="toolbar">
            <button className="btn" onClick={() => { setIsDrawingMode(!isDrawingMode); setIsTextMode(false); setIsEditFrameMode(false); document.body.style.cursor = !isDrawingMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isDrawingMode ? '#fef08a' : 'transparent', color: isDrawingMode ? '#ca8a04' : '#475569' }}><PencilRuler size={18} /> {isDrawingMode ? 'Đang vẽ...' : 'Vẽ Dim'}</button>
            <button className="btn" onClick={handleMagicDim} style={{ color: canUse('magicDim') ? '#d946ef' : '#94a3b8' }}>{!canUse('magicDim') && <Crown size={14} color="#eab308" />}<Wand2 size={18} /> Magic Dim</button>
            <button className="btn" onClick={() => { setIsTextMode(!isTextMode); setIsDrawingMode(false); setIsEditFrameMode(false); document.body.style.cursor = !isTextMode ? 'text' : 'default'; setSelectedId(null); }} style={{ background: isTextMode ? '#dbeafe' : 'transparent', color: isTextMode ? '#2563eb' : '#475569' }}><Type size={18} /> {isTextMode ? 'Đang ghi chú...' : 'Ghi chú'}</button>
            <div className="divider"></div>
            <button className="btn" onClick={() => { setShowFrame(!showFrame); setIsEditFrameMode(false); }} style={{ background: showFrame ? '#fee2e2' : 'transparent', color: showFrame ? '#b91c1c' : '#475569' }}><Frame size={18} /> {showFrame ? 'Tắt Khung' : 'Bật Khung'}</button>
            {showFrame && customFrame && (
              <button className="btn" onClick={() => { setIsEditFrameMode(!isEditFrameMode); setIsDrawingMode(false); setIsTextMode(false); document.body.style.cursor = 'default'; }} style={{ background: isEditFrameMode ? '#dbeafe' : 'transparent', color: isEditFrameMode ? '#1d4ed8' : '#475569', border: isEditFrameMode ? '1px solid #93c5fd' : 'none' }}>
                {isEditFrameMode ? <Lock size={18} /> : <Unlock size={18} />} Khóa/Mở
              </button>
            )}
            <div className="divider"></div>
            <button className="btn" onClick={() => { setSelectedId(null); setIsEditFrameMode(false); setTimeout(() => executeDownload(currentDoc), 100); }}><Download size={18} /> Lưu ảnh</button>
          </div>
        )}

        {!currentDoc ? (
          <div className="gallery-view">
            <div className="gallery-header">
              <button className="btn btn-icon" onClick={() => setCurrentProjectId(null)} style={{ padding: 4 }}><ArrowLeft size={20} /></button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 'bold', fontSize: 16 }}>{currentProject?.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{docs.length} ảnh</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="file-input-wrapper">
                  <button className="btn btn-primary" style={{ padding: '8px 14px' }}><Camera size={18} /> {isMobile ? '' : 'Chụp'}</button>
                  <input type="file" onChange={handleUpload} accept="image/*" capture="environment" />
                </div>
                <div className="file-input-wrapper">
                  <button className="btn" style={{ padding: '8px 14px', border: '1px solid #cbd5e1' }}><ImagePlus size={18} /> {isMobile ? '' : 'Thư viện'}</button>
                  <input type="file" multiple onChange={handleUpload} accept="image/*" />
                </div>
              </div>
            </div>
            {docs.length === 0 ? (
              <div className="empty-state">
                <div className="upload-box">
                  <Camera size={64} style={{ marginBottom: 10, color: '#3b82f6' }} />
                  <h2 style={{ fontSize: '18px', margin: '5px 0' }}>Chụp ảnh hoặc Tải ảnh lên</h2>
                </div>
              </div>
            ) : (
              <div className="gallery-grid">
                {docs.map(doc => (
                  <div key={doc.id} className="gallery-item" onClick={() => setActiveDocId(doc.id)}>
                    <img src={doc.img.src} alt={doc.name} />
                    <div className="gallery-item-name">{doc.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {!isMobile && (
              <div className="hint-text">
                {isDrawingMode ? 'Kéo chuột để vẽ (Giữ SHIFT để khóa trục)' : isTextMode ? 'Click vào ảnh để đặt ghi chú' : 'Ctrl+Z (Undo) | Ctrl+Y (Redo) | Ctrl+C/V | Delete'}
              </div>
            )}
            <Stage width={stageSize.width} height={stageSize.height} ref={stageRef} scaleX={currentDoc.stageScale} scaleY={currentDoc.stageScale} x={currentDoc.stagePos.x} y={currentDoc.stagePos.y}
              draggable={false}
              onWheel={handleWheel}
              onMouseDown={handleStageMouseDown} onMouseMove={handleStageMouseMove} onMouseUp={handleStageMouseUp}
              onTouchStart={handleStageMouseDown} onTouchMove={handleStageMouseMove} onTouchEnd={handleStageMouseUp}
            >
              <Layer>
                <KonvaImage image={currentDoc.img} x={0} y={0} />
                {currentDoc.lines.map(line => (
                  <DimensionLine key={line.id} line={line} stageScale={currentDoc.stageScale} isSelected={line.id === selectedId} onSelect={setSelectedId} onTextEdit={handleTextEdit}
                    onChange={(newVal, commit = false) => {
                      const newLines = currentDoc.lines.map(l => l.id === newVal.id ? newVal : l);
                      if (commit) commitHistory(newLines, currentDoc.texts || []); else updateDoc({ lines: newLines });
                    }}
                  />
                ))}
                {(currentDoc.texts || []).map(note => (
                  <TextNote key={note.id} note={note} stageScale={currentDoc.stageScale} isSelected={note.id === selectedId} onSelect={setSelectedId} onEdit={handleTextNoteEdit}
                    onChange={(newVal, commit = false) => {
                      const newTexts = (currentDoc.texts || []).map(t => t.id === newVal.id ? newVal : t);
                      if (commit) commitHistory(currentDoc.lines, newTexts); else updateDoc({ texts: newTexts });
                    }}
                  />
                ))}
                {tempLine && <KonvaLine points={[tempLine.start.x, tempLine.start.y, tempLine.end.x, tempLine.end.y]} stroke="#eab308" strokeWidth={2 / currentDoc.stageScale} dash={[5 / currentDoc.stageScale, 5 / currentDoc.stageScale]} />}
                {customWatermark ? (
                  <KonvaImage image={customWatermark} x={currentDoc.img.width / 2} y={currentDoc.img.height / 2} offsetX={customWatermark.width / 2} offsetY={customWatermark.height / 2} scaleX={(currentDoc.img.width * 0.4) / customWatermark.width} scaleY={(currentDoc.img.width * 0.4) / customWatermark.width} opacity={0.3} listening={false} />
                ) : watermarkTxt ? (
                  <Group x={currentDoc.img.width / 2} y={currentDoc.img.height / 2} rotation={-25} listening={false}>
                    <Text x={-currentDoc.img.width} y={-currentDoc.img.width * 0.05} width={currentDoc.img.width * 2} text={watermarkTxt} fontSize={Math.max(currentDoc.img.width / 12, 50)} fill="rgba(255,255,255,0.35)" stroke="rgba(0,0,0,0.15)" strokeWidth={3} align="center" fontStyle="bold" fontFamily="Inter" />
                  </Group>
                ) : null}
                {showFrame && (customFrame && currentDoc.frameAttrs ? (
                  <FrameOverlay frameImg={customFrame} frameAttrs={currentDoc.frameAttrs} isEditing={isEditFrameMode} onChange={(newAttrs) => updateDoc({ frameAttrs: newAttrs })} />
                ) : (
                  <Group listening={false}>
                    <KonvaRect x={20} y={20} width={currentDoc.img.width - 40} height={currentDoc.img.height - 40} stroke="#ef4444" strokeWidth={6} />
                    <KonvaRect x={28} y={28} width={currentDoc.img.width - 56} height={currentDoc.img.height - 56} stroke="#ef4444" strokeWidth={2} />
                    <KonvaRect x={currentDoc.img.width - 320} y={currentDoc.img.height - 130} width={300} height={110} fill="rgba(0,0,0,0.7)" stroke="#ef4444" strokeWidth={2} />
                    <Text x={currentDoc.img.width - 305} y={currentDoc.img.height - 115} text="BẢN VẼ DIMENSION" fill="white" fontSize={20} fontStyle="bold" fontFamily="Inter" />
                    <Text x={currentDoc.img.width - 305} y={currentDoc.img.height - 85} text={`File: ${currentDoc.name.substring(0, 25)}...`} fill="#cbd5e1" fontSize={14} fontFamily="Inter" />
                    <Text x={currentDoc.img.width - 305} y={currentDoc.img.height - 60} text={`Ngày: ${new Date().toLocaleDateString('vi-VN')}`} fill="#cbd5e1" fontSize={14} fontFamily="Inter" />
                  </Group>
                ))}
              </Layer>
            </Stage>

            {/* Floating toolbar */}
            {selectedId && !isMobile && (
              <div className="floating-dim-toolbar">
                <button className="btn btn-icon" onClick={() => {
                  const line = currentDoc.lines.find(l => l.id === selectedId);
                  const note = (currentDoc.texts || []).find(t => t.id === selectedId);
                  if (line) handleTextEdit(line); else if (note) handleTextNoteEdit(note);
                }}><Edit3 size={18} color="#2563eb" /> <span style={{ fontSize: 12, marginLeft: 6, color: '#2563eb', fontWeight: 600 }}>Sửa</span></button>
                <div style={{ width: 1, backgroundColor: '#e2e8f0', height: 20, margin: '0 8px' }}></div>
                <button className="btn btn-icon" onClick={() => {
                  const isLine = currentDoc.lines.some(l => l.id === selectedId);
                  if (isLine) commitHistory(currentDoc.lines.filter(l => l.id !== selectedId), currentDoc.texts || []);
                  else commitHistory(currentDoc.lines, (currentDoc.texts || []).filter(t => t.id !== selectedId));
                  setSelectedId(null);
                }}><Trash2 size={18} color="#ef4444" /> <span style={{ fontSize: 12, marginLeft: 6, color: '#ef4444', fontWeight: 600 }}>Xóa</span></button>
              </div>
            )}
            {selectedId && isMobile && (
              <div className="floating-dim-toolbar mobile-floating">
                <button className="btn btn-icon" style={{ flexDirection: 'column', gap: 4 }} onClick={() => {
                  const line = currentDoc.lines.find(l => l.id === selectedId);
                  const note = (currentDoc.texts || []).find(t => t.id === selectedId);
                  if (line) handleTextEdit(line); else if (note) handleTextNoteEdit(note);
                }}><Edit3 size={20} color="#2563eb" /> <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 600 }}>Sửa</span></button>
                <div style={{ width: 1, backgroundColor: '#e2e8f0', height: 24, margin: '0 12px' }}></div>
                <button className="btn btn-icon" style={{ flexDirection: 'column', gap: 4 }} onClick={() => {
                  const isLine = currentDoc.lines.some(l => l.id === selectedId);
                  if (isLine) commitHistory(currentDoc.lines.filter(l => l.id !== selectedId), currentDoc.texts || []);
                  else commitHistory(currentDoc.lines, (currentDoc.texts || []).filter(t => t.id !== selectedId));
                  setSelectedId(null);
                }}><Trash2 size={20} color="#ef4444" /> <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>Xóa</span></button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile bottom bar */}
      {isMobile && currentDoc && (
        <div className="bottom-bar">
          <div className="bottom-tools">
            <button className="btn btn-icon" onClick={() => setActiveDocId(null)} style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}><ArrowLeft size={22} /></button>
            <button className="btn btn-icon" onClick={() => setShowMobileHistory(true)} style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}><Images size={22} /></button>
            <div className="divider"></div>
            <div className="file-input-wrapper"><button className="btn btn-icon btn-primary"><Camera size={22} /></button><input type="file" onChange={handleUpload} accept="image/*" capture="environment" /></div>
            <div className="file-input-wrapper"><button className="btn btn-icon" style={{ border: '1px dashed #cbd5e1' }}><ImagePlus size={22} /></button><input type="file" multiple onChange={handleUpload} accept="image/*" /></div>
            <div className="divider"></div>
            <button className={`btn btn-icon ${isDrawingMode ? 'active-tool' : ''}`} onClick={() => { setIsDrawingMode(!isDrawingMode); setIsTextMode(false); setIsEditFrameMode(false); document.body.style.cursor = !isDrawingMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isDrawingMode ? '#fef08a' : 'transparent', color: isDrawingMode ? '#ca8a04' : '#475569' }}><PencilRuler size={22} /></button>
            <button className="btn btn-icon" onClick={handleMagicDim} style={{ color: canUse('magicDim') ? '#d946ef' : '#94a3b8', position: 'relative' }}><Wand2 size={22} />{!canUse('magicDim') && <Crown size={10} color="#eab308" style={{ position: 'absolute', top: 4, right: 4 }} />}</button>
            <button className={`btn btn-icon ${isTextMode ? 'active-tool' : ''}`} onClick={() => { setIsTextMode(!isTextMode); setIsDrawingMode(false); setIsEditFrameMode(false); document.body.style.cursor = !isTextMode ? 'text' : 'default'; setSelectedId(null); }} style={{ background: isTextMode ? '#dbeafe' : 'transparent', color: isTextMode ? '#2563eb' : '#475569' }}><Type size={22} /></button>
            <div className="divider"></div>
            <button className="btn btn-icon" onClick={() => { if (requireFeature('share')) handleShare(currentDoc); }} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', position: 'relative' }}><Share2 size={22} color={canUse('share') ? '#2563eb' : '#94a3b8'} />{!canUse('share') && <Crown size={10} color="#eab308" style={{ position: 'absolute', top: 4, right: 4 }} />}</button>
            <button className="btn btn-icon" onClick={() => { setSelectedId(null); setIsEditFrameMode(false); setTimeout(() => executeDownload(currentDoc), 100); }}><Download size={22} color="#059669" /></button>
          </div>
        </div>
      )}

      {/* Mobile history popup */}
      {isMobile && showMobileHistory && (
        <div className="mobile-history-overlay" onClick={() => setShowMobileHistory(false)}>
          <div className="mobile-history-modal" onClick={e => e.stopPropagation()}>
            <div className="mobile-history-header">
              <h3 style={{ margin: 0, fontSize: '16px', color: '#1e293b' }}>Ảnh trong dự án ({docs.length})</h3>
              <button className="btn btn-icon" onClick={() => setShowMobileHistory(false)} style={{ padding: '4px' }}><X size={20} /></button>
            </div>
            <div className="mobile-history-list">
              {docs.map(doc => (
                <div key={doc.id} className={`thumb-item ${doc.id === activeDocId ? 'active' : ''}`} onClick={() => { setActiveDocId(doc.id); setShowMobileHistory(false); }}>
                  <img src={doc.img.src} alt="thumb" />
                  <div className="thumb-name">{doc.name}</div>
                </div>
              ))}
              {docs.length === 0 && <p style={{ textAlign: 'center', width: '100%', color: '#94a3b8' }}>Chưa có ảnh nào</p>}
            </div>
            <div style={{ padding: '15px', borderTop: '1px solid #e2e8f0' }}>
              <button className="btn w-full" onClick={handleBatchExport} disabled={docs.length === 0 || isExportingAll} style={{ justifyContent: 'center', width: '100%', color: '#059669', background: '#ecfdf5', border: '1px solid #34d399', fontSize: '15px', padding: '10px' }}>
                <SaveAll size={20} /> {isExportingAll ? 'Đang xuất...' : 'Lưu tất cả ảnh'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgrade && (
        <UpgradeModal feature={upgradeFeature} onClose={dismissUpgrade} onShowPricing={() => { dismissUpgrade(); setShowPricing(true); }} />
      )}
    </div>
  );
}