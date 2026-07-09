import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line as KonvaLine, Rect as KonvaRect, Text, Group, Circle } from 'react-konva';
import { ImagePlus, Download, PencilRuler, Frame, Stamp, SaveAll, Unlock, Lock, Camera, Images, X, Share2, Wand2, Edit3, Trash2, Type, ArrowLeft, Crown, RefreshCw, CheckSquare, Square, Crosshair, Ruler, BrickWall, FileDown, Scan } from 'lucide-react';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import DimensionLine from './components/DimensionLine';
import FrameOverlay from './components/FrameOverlay';
import TextNote from './components/TextNote';
import PolylineDimGroup from './components/PolylineDimGroup';
import CalibrationOverlay from './components/CalibrationOverlay';
import { computeHomography, measureRealDistance } from './perspectiveUtils';
import ProjectList from './components/ProjectList';
import UpgradeModal from './components/UpgradeModal';
import PricingPage from './components/PricingPage';
import AuthPage from './components/AuthPage';
import SettingsPage from './components/SettingsPage';
import { useTier } from './TierContext';
import * as GDrive from './googleDriveService';
import { loadProjects, saveProjects, loadDocs, saveDocs, deleteProjectDocs } from './db';
import PlanGrid from './plan/PlanGrid';
import WallsLayer from './plan/WallsLayer';
import RoomLabels from './plan/RoomLabels';
import WallDrawPreview from './plan/WallDrawPreview';
import PlanSettingsBar from './plan/PlanSettingsBar';
import { snapToGrid, snapOrtho, findNearbyNode, applyWallLength, scaleAllWalls, snapToWall, splitWallAtPoint, contentBBox, dist as planDist } from './plan/planGeometry';
import { createPlanDoc, addWallSegment, deleteWall, moveNode, renameRoom, recomputeRooms, addOpening, removeOpening, updateOpening } from './plan/planModel';
import { generateDxf } from './plan/dxf';
import { startARScan, checkARAvailability, buildPlanFromARCorners } from './plan/arRoomScan';
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
  const [isPolylineMode, setIsPolylineMode] = useState(false);
  const [activePolyline, setActivePolyline] = useState(null);
  const [polylinePreview, setPolylinePreview] = useState(null);
  const [isCalibMode, setIsCalibMode] = useState(false);
  const [calibPoints, setCalibPoints] = useState([]);
  const [isVerticalMode, setIsVerticalMode] = useState(false);
  const [verticalPoints, setVerticalPoints] = useState([]);
  const [tempLine, setTempLine] = useState(null);
  const [isWallMode, setIsWallMode] = useState(false);
  const [isEditKTMode, setIsEditKTMode] = useState(false);
  const [isPlaceDoorMode, setIsPlaceDoorMode] = useState(false);
  const [isPlaceWindowMode, setIsPlaceWindowMode] = useState(false);
  const [selectedOpeningId, setSelectedOpeningId] = useState(null); // { wallId, openingId }
  const [wallChain, setWallChain] = useState(null); // { anchor: {nodeId|null,x,y}, startNodeId }
  const [wallPreview, setWallPreview] = useState(null); // {nodeId|null,x,y}
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

  // === Gallery select & sync state ===
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');

  const { canUse, requireFeature, limits, showUpgrade, upgradeFeature, dismissUpgrade, currentTier, setCurrentTier, user, setUser, logout } = useTier();

  const mainAreaRef = useRef();
  const stageRef = useRef();
  const currentDoc = docs.find(d => d.id === activeDocId);
  const saveTimeoutRef = useRef(null);
  const lastTouchDistRef = useRef(null);
  const lastTouchCenterRef = useRef(null);
  const tapRef = useRef(null); // wall mode: pending tap {x,y,moved} — point is placed on tap-END
  const isPlanDoc = currentDoc?.type === 'plan';

  // === Load projects on mount ===
  useEffect(() => {
    (async () => {
      const p = await loadProjects();
      setProjects(p);
      // Always start from project list screen, not auto-open last project
      setLoadingDB(false);
    })();
  }, []);

  // === Android back button ===
  useEffect(() => {
    const handler = CapApp.addListener('backButton', () => {
      if (wallChain || isWallMode) {
        setWallChain(null); setWallPreview(null); setIsWallMode(false);
      } else if (isEditKTMode) {
        setIsEditKTMode(false);
      } else if (isPlaceDoorMode || isPlaceWindowMode) {
        setIsPlaceDoorMode(false); setIsPlaceWindowMode(false);
      } else if (showMobileHistory) {
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
  }, [showMobileHistory, activeDocId, currentProjectId, wallChain, isWallMode, isEditKTMode, isPlaceDoorMode, isPlaceWindowMode]);

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
      // Plan docs have no image — dropping them here would permanently delete them on next autosave
      setDocs(hydrated.filter(d => d.img || d.type === 'plan'));
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

  const commitHistory = (newLines, newTexts, newPolylines, newPlan) => {
    setDocs(prev => prev.map(d => {
      if (d.id !== activeDocId) return d;
      const history = d.linesHistory.slice(0, d.historyStep + 1);
      const textsHistory = (d.textsHistory || [[]]).slice(0, d.historyStep + 1);
      const polylinesHistory = (d.polylinesHistory || [[]]).slice(0, d.historyStep + 1);
      const planHistory = (d.planHistory || [d.plan || null]).slice(0, d.historyStep + 1);
      const lines = newLines !== undefined ? newLines : d.lines;
      const texts = newTexts !== undefined ? newTexts : (d.texts || []);
      const polylines = newPolylines !== undefined ? newPolylines : (d.polylines || []);
      const plan = newPlan !== undefined ? newPlan : (d.plan || null);
      history.push(lines);
      textsHistory.push(texts);
      polylinesHistory.push(polylines);
      planHistory.push(plan);
      return { ...d, lines, texts, polylines, plan, linesHistory: history, textsHistory, polylinesHistory, planHistory, historyStep: history.length - 1 };
    }));
  };

  const restoreHistoryStep = (s) => {
    const ph = currentDoc.planHistory || [];
    updateDoc({
      lines: currentDoc.linesHistory[s],
      texts: (currentDoc.textsHistory || [[]])[s] || [],
      polylines: (currentDoc.polylinesHistory || [[]])[s] || [],
      plan: s < ph.length ? ph[s] : (currentDoc.plan || null),
      historyStep: s
    });
    setSelectedId(null);
    setWallChain(null); setWallPreview(null);
  };

  const doUndo = () => { if (currentDoc && currentDoc.historyStep > 0) restoreHistoryStep(currentDoc.historyStep - 1); };
  const doRedo = () => { if (currentDoc && currentDoc.historyStep < currentDoc.linesHistory.length - 1) restoreHistoryStep(currentDoc.historyStep + 1); };

  // === Keyboard shortcuts ===
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!currentDoc) return;
      if (e.key === 'Escape') {
        if (isWallMode && wallChain) {
          setWallChain(null); setWallPreview(null);
        } else if (isWallMode) {
          setIsWallMode(false); document.body.style.cursor = 'default';
        } else if (isEditKTMode) {
          setIsEditKTMode(false);
        } else if (isPlaceDoorMode || isPlaceWindowMode) {
          setIsPlaceDoorMode(false); setIsPlaceWindowMode(false);
        } else if (isPolylineMode && activePolyline && activePolyline.points.length >= 2) {
          finishPolyline();
        } else {
          setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setSelectedId(null); setIsEditFrameMode(false); document.body.style.cursor = 'default';
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null && !isEditFrameMode) {
        const isLine = currentDoc.lines.some(l => l.id === selectedId);
        const isPoly = (currentDoc.polylines || []).some(p => p.id === selectedId);
        const isWall = !!(currentDoc.plan && currentDoc.plan.walls.some(w => w.id === selectedId));
        if (isWall) handleDeleteWall(selectedId);
        else if (isLine) commitHistory(currentDoc.lines.filter(l => l.id !== selectedId), currentDoc.texts || []);
        else if (isPoly) commitHistory(currentDoc.lines, currentDoc.texts || [], (currentDoc.polylines || []).filter(p => p.id !== selectedId));
        else commitHistory(currentDoc.lines, (currentDoc.texts || []).filter(t => t.id !== selectedId));
        setSelectedId(null);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z') doUndo();
      if (e.ctrlKey && e.key.toLowerCase() === 'y') doRedo();
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
  }, [currentDoc, selectedId, isEditFrameMode, copiedLine, isWallMode, wallChain, isEditKTMode, isPlaceDoorMode, isPlaceWindowMode, isPolylineMode, activePolyline]);

  // === Frame / watermark helpers ===
  const initFrameAttrs = (baseImg, overlayImg) => {
    const scale = Math.min(baseImg.width / overlayImg.width, baseImg.height / overlayImg.height);
    const fw = overlayImg.width * scale; const fh = overlayImg.height * scale;
    return { x: (baseImg.width - fw) / 2, y: (baseImg.height - fh) / 2, width: fw, height: fh };
  };

  // === Upload handlers ===
  const handleUpload = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    // Enforce photo limit
    const currentCount = docs.length;
    const maxPhotos = limits.maxPhotosPerProject;
    if (currentCount >= maxPhotos) {
      requireFeature('uploadPhoto');
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
            lines: [], texts: [], polylines: [], linesHistory: [[]], textsHistory: [[]], polylinesHistory: [[]], historyStep: 0,
            globalRatio: null, calibPoints: null, homography: null,
            frameAttrs: customFrame ? initFrameAttrs(image, customFrame) : null,
            stageScale: autoScale,
            stagePos: { x: (w - image.width * autoScale) / 2, y: (h - image.height * autoScale) / 2 + 20 }
          };
          setDocs(prev => [...prev, newDoc]);
          setActiveDocId(newDoc.id);
          // Update project doc count
          setProjects(prev => {
            const updated = prev.map(p => p.id === currentProjectId ? { ...p, docCount: (p.docCount || 0) + 1 } : p);
            saveProjects(updated);
            return updated;
          });
          // Auto-upload original image to Google Drive
          if (GDrive.isConnected() && localStorage.getItem('gdrive_auto_upload') === 'true') {
            const projectName = projects.find(p => p.id === currentProjectId)?.name || '';
            const b64 = base64.split(',')[1];
            GDrive.uploadImage(b64, file.name, projectName).catch(err => console.warn('GDrive upload:', err));
          }
        };
      };
      reader.readAsDataURL(file);
    });
    if (showMobileHistory) setShowMobileHistory(false);
  };

  // === Create blank floor-plan doc (1 canvas unit = 1 mm) ===
  const handleCreatePlanDoc = () => {
    if (docs.length >= limits.maxPhotosPerProject) {
      requireFeature('uploadPhoto');
      return;
    }
    const w = mainAreaRef.current ? mainAreaRef.current.offsetWidth : window.innerWidth;
    const h = mainAreaRef.current ? mainAreaRef.current.offsetHeight : window.innerHeight - 150;
    const count = docs.filter(d => d.type === 'plan').length + 1;
    const newDoc = createPlanDoc(`Mặt bằng ${count}`, { width: w, height: h });
    setDocs(prev => [...prev, newDoc]);
    setActiveDocId(newDoc.id);
    // Jump straight into the wall tool — that's what the user came for on site
    setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsEditFrameMode(false);
    setIsWallMode(true); setWallChain(null); setWallPreview(null); setSelectedId(null);
    setProjects(prev => {
      const updated = prev.map(p => p.id === currentProjectId ? { ...p, docCount: (p.docCount || 0) + 1 } : p);
      saveProjects(updated);
      return updated;
    });
    if (showMobileHistory) setShowMobileHistory(false);
  };

  const handleARScan = async () => {
    if (!Capacitor.isNativePlatform()) {
      alert('Quét AR chỉ khả dụng trên ứng dụng Android. Trên web hãy dùng "Vẽ mặt bằng" thủ công.');
      return;
    }
    try {
      const avail = await checkARAvailability();
      if (!avail.available) {
        alert('Thiết bị này không hỗ trợ ARCore.\nHãy dùng "Vẽ mặt bằng" và nhập laser thủ công.');
        return;
      }
      const result = await startARScan();
      if (!result || !result.corners || result.corners.length < 3) {
        alert('Quét AR không đủ góc (cần ít nhất 3). Thử lại hoặc vẽ thủ công.');
        return;
      }
      const planData = buildPlanFromARCorners(result.corners, 110);
      const w = mainAreaRef.current ? mainAreaRef.current.offsetWidth : window.innerWidth;
      const h = mainAreaRef.current ? mainAreaRef.current.offsetHeight : window.innerHeight - 150;
      const count = docs.filter(d => d.type === 'plan').length + 1;
      const newDoc = createPlanDoc(`AR Scan ${count}`, { width: w, height: h });
      newDoc.plan = recomputeRooms(planData);
      newDoc.planHistory = [newDoc.plan];
      if (result.ceilingHeight) newDoc.planSettings = { ...newDoc.planSettings, ceilingHeight: result.ceilingHeight };
      setDocs(prev => [...prev, newDoc]);
      setActiveDocId(newDoc.id);
      setIsWallMode(false); setWallChain(null); setWallPreview(null); setSelectedId(null);
      setProjects(prev => {
        const updated = prev.map(p => p.id === currentProjectId ? { ...p, docCount: (p.docCount || 0) + 1 } : p);
        saveProjects(updated);
        return updated;
      });
      if (showMobileHistory) setShowMobileHistory(false);
    } catch (err) {
      if (err && err.message !== 'cancelled') {
        alert('Lỗi AR: ' + (err.message || err));
      }
    }
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
      // Plan docs are always 1 unit = 1 mm; editing a label must never change the ratio
      if (!isNaN(val) && pxDist > 0 && !currentDoc.homography && currentDoc.type !== 'plan') updateDoc({ globalRatio: val / pxDist });
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

  // === Polyline helpers ===
  const finishPolyline = () => {
    if (!activePolyline || activePolyline.points.length < 2) {
      setActivePolyline(null); setPolylinePreview(null);
      return;
    }
    const pts = activePolyline.points;
    const labels = pts.slice(0, -1).map((p, i) => {
      const np = pts[i + 1];
      if (currentDoc.homography) {
        const realDist = measureRealDistance(currentDoc.homography, p, np);
        return (Math.round(realDist / 10) * 10).toString();
      }
      const dx = np.x - p.x; const dy = np.y - p.y;
      return Math.round(Math.sqrt(dx * dx + dy * dy)).toString();
    });
    const newPoly = { ...activePolyline, labels, id: Date.now() };
    commitHistory(currentDoc.lines, currentDoc.texts || [], [...(currentDoc.polylines || []), newPoly]);
    setSelectedId(newPoly.id);
    setActivePolyline(null); setPolylinePreview(null);
  };

  const getPerpendicularPoint = (lastPt, prevPt, rawX, rawY) => {
    const dx = lastPt.x - prevPt.x; const dy = lastPt.y - prevPt.y;
    const isHoriz = Math.abs(dx) > Math.abs(dy);
    // If previous segment was horizontal, next must be vertical and vice versa
    if (isHoriz) return { x: lastPt.x, y: rawY };
    else return { x: rawX, y: lastPt.y };
  };

  const handlePolylineLabelEdit = (polyId, segIdx) => {
    const poly = (currentDoc.polylines || []).find(p => p.id === polyId);
    if (!poly) return;
    const userInput = prompt("Nhập kích thước thực tế (VD: 3600):", poly.labels[segIdx]);
    if (userInput === null) return;
    const val = parseFloat(userInput);
    if (isNaN(val) || val <= 0) return;
    const p1 = poly.points[segIdx]; const p2 = poly.points[segIdx + 1];
    const pxDist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    if (pxDist <= 0) return;

    if (!poly.ratio) {
      // === FIRST dimension entry: establish ratio, update all labels ===
      const ratio = val / pxDist;
      const newLabels = poly.points.slice(0, -1).map((pt, i) => {
        const npt = poly.points[i + 1];
        const d = Math.sqrt((npt.x - pt.x) ** 2 + (npt.y - pt.y) ** 2);
        let rv = d * ratio;
        rv = Math.round(rv / 10) * 10;
        return rv.toString();
      });
      newLabels[segIdx] = val.toString();
      updateDoc({ globalRatio: ratio });
      const newPolys = (currentDoc.polylines || []).map(p => p.id === polyId ? { ...p, labels: newLabels, ratio } : p);
      commitHistory(currentDoc.lines, currentDoc.texts || [], newPolys);
    } else {
      // === Subsequent entries: physically resize the segment to match ===
      const targetPx = val / poly.ratio;
      // Direction of this segment
      const dx = p2.x - p1.x; const dy = p2.y - p1.y;
      const angle = Math.atan2(dy, dx);
      // New endpoint for this segment
      const newP2 = { x: p1.x + Math.cos(angle) * targetPx, y: p1.y + Math.sin(angle) * targetPx };
      // Shift all subsequent points by the delta
      const delta = { x: newP2.x - p2.x, y: newP2.y - p2.y };
      const newPoints = poly.points.map((pt, i) => {
        if (i <= segIdx) return { ...pt };
        return { x: pt.x + delta.x, y: pt.y + delta.y };
      });
      // Recalculate all labels with existing ratio
      const newLabels = newPoints.slice(0, -1).map((pt, i) => {
        const npt = newPoints[i + 1];
        const d = Math.sqrt((npt.x - pt.x) ** 2 + (npt.y - pt.y) ** 2);
        let rv = d * poly.ratio;
        rv = Math.round(rv / 10) * 10;
        return rv.toString();
      });
      newLabels[segIdx] = val.toString();
      const newPolys = (currentDoc.polylines || []).map(p => p.id === polyId ? { ...p, points: newPoints, labels: newLabels } : p);
      commitHistory(currentDoc.lines, currentDoc.texts || [], newPolys);
    }
  };

  // === Plan / wall helpers ===
  const planSnapFn = (pt) => {
    const s = currentDoc?.planSettings;
    if (!s || !s.gridSnap) return pt;
    return snapToGrid(pt, s.gridMinor || 100);
  };

  // Snap priority: existing node > grid > ortho (grid first so ortho against an on-grid anchor stays on grid)
  const resolvePlanPoint = (worldPt, anchorPt) => {
    const s = currentDoc.planSettings || {};
    const tol = 24 / currentDoc.stageScale;
    const near = findNearbyNode(currentDoc.plan.nodes, worldPt, tol);
    if (near) return { nodeId: near.id, x: near.x, y: near.y };
    let pt = worldPt;
    if (s.gridSnap) pt = snapToGrid(pt, s.gridMinor || 100);
    if (anchorPt && s.orthoMode) pt = snapOrtho(anchorPt, pt);
    return { nodeId: null, x: pt.x, y: pt.y };
  };

  const handleWallTap = (screenPos) => {
    const stage = stageRef.current;
    const x = (screenPos.x - stage.x()) / stage.scaleX();
    const y = (screenPos.y - stage.y()) / stage.scaleY();
    if (!wallChain) {
      const a = resolvePlanPoint({ x, y }, null);
      setWallChain({ anchor: a, startNodeId: a.nodeId });
      setWallPreview(null);
      return;
    }
    const anchorPt = { x: wallChain.anchor.x, y: wallChain.anchor.y };
    let end = resolvePlanPoint({ x, y }, anchorPt);
    if (planDist(anchorPt, end) < 50) return; // < 50 mm — ignore accidental double tap

    // T-junction: if endpoint hits the mid-segment of another wall, split it
    let workingPlan = currentDoc.plan;
    if (!end.nodeId) {
      const snapThresh = 20 / currentDoc.stageScale;
      const hit = snapToWall(workingPlan, { x: end.x, y: end.y }, snapThresh);
      if (hit) {
        const { plan: splitPlan, newNodeId } = splitWallAtPoint(workingPlan, hit.wallId, { x: hit.x, y: hit.y });
        workingPlan = splitPlan;
        end = { nodeId: newNodeId, x: hit.x, y: hit.y };
      }
    }

    const res = addWallSegment(workingPlan, wallChain.anchor, end, (currentDoc.planSettings || {}).wallThickness || 110);
    if (res.added) {
      commitHistory(undefined, undefined, undefined, recomputeRooms(res.plan));
    }
    if (res.closed) {
      // Ended on an existing node: loop closed or joined the network — chain done
      setWallChain(null); setWallPreview(null);
    } else {
      setWallChain({ anchor: { nodeId: res.endNodeId, x: end.x, y: end.y }, startNodeId: wallChain.startNodeId || res.startNodeId });
    }
  };

  const finishWallChain = () => { setWallChain(null); setWallPreview(null); };

  const handleWallLabelEdit = (wallId) => {
    const plan = currentDoc.plan;
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return;
    const a = plan.nodes.find(n => n.id === wall.a);
    const b = plan.nodes.find(n => n.id === wall.b);
    if (!a || !b) return;
    const cur = Math.round(planDist(a, b));
    const calibHint = !plan.calibrated ? ' (lần đầu — scale toàn bộ)' : '';
    const input = prompt(`Nhập chiều dài thực tế (mm)${calibHint}:`, String(cur));
    if (input === null) return;
    const val = parseFloat(input);
    if (isNaN(val) || val <= 0) return;
    if (!plan.calibrated) {
      // First edit: global scale — all walls proportionally resize
      const { plan: scaled } = scaleAllWalls(plan, wallId, val);
      commitHistory(undefined, undefined, undefined, recomputeRooms(scaled));
    } else {
      // Subsequent edits: individual wall resize
      const { plan: resized, warning } = applyWallLength(plan, wallId, val);
      commitHistory(undefined, undefined, undefined, recomputeRooms(resized));
      if (warning) alert(warning);
    }
  };

  const handleNodeDrag = (nodeId, pos, commit) => {
    const newPlan = moveNode(currentDoc.plan, nodeId, pos);
    if (commit) commitHistory(undefined, undefined, undefined, recomputeRooms(newPlan));
    else updateDoc({ plan: newPlan });
  };

  const handleRoomRename = (roomId) => {
    const room = (currentDoc.plan.rooms || []).find(r => r.id === roomId);
    if (!room) return;
    const name = prompt('Tên phòng:', room.name);
    if (name === null || !name.trim()) return;
    commitHistory(undefined, undefined, undefined, renameRoom(currentDoc.plan, roomId, name.trim()));
  };

  const handleDeleteWall = (wallId) => {
    commitHistory(undefined, undefined, undefined, recomputeRooms(deleteWall(currentDoc.plan, wallId)));
    setSelectedId(null);
  };

  const handlePlaceOpening = (wallId, t) => {
    const type = isPlaceDoorMode ? 'door' : 'window';
    const width = type === 'door' ? 900 : 1200;
    const { plan: newPlan, openingId } = addOpening(currentDoc.plan, wallId, t, type, width);
    commitHistory(undefined, undefined, undefined, newPlan);
    setSelectedOpeningId({ wallId, openingId });
    setIsPlaceDoorMode(false); setIsPlaceWindowMode(false);
  };

  const handleSelectOpening = (wallId, openingId) => {
    setSelectedOpeningId({ wallId, openingId });
    setSelectedId(null);
  };

  const handleOpeningLabelEdit = () => {
    if (!selectedOpeningId) return;
    const { wallId, openingId } = selectedOpeningId;
    const wall = currentDoc.plan.walls.find(w => w.id === wallId);
    if (!wall) return;
    const op = (wall.openings || []).find(o => o.id === openingId);
    if (!op) return;
    const input = prompt(`Kích thước ${op.type === 'door' ? 'cửa đi' : 'cửa sổ'} (mm):`, String(op.width));
    if (input === null) return;
    const val = parseFloat(input);
    if (isNaN(val) || val <= 0) return;
    commitHistory(undefined, undefined, undefined, updateOpening(currentDoc.plan, wallId, openingId, { width: val }));
  };

  const handleDeleteOpening = () => {
    if (!selectedOpeningId) return;
    const { wallId, openingId } = selectedOpeningId;
    commitHistory(undefined, undefined, undefined, removeOpening(currentDoc.plan, wallId, openingId));
    setSelectedOpeningId(null);
  };

  const handleStageMouseDown = (e) => {
    if (isEditFrameMode) return;
    // Pinch zoom start: 2 fingers
    if (e.evt?.touches?.length === 2) {
      if (e.evt.cancelable) e.evt.preventDefault();
      tapRef.current = null; // second finger cancels a pending wall tap
      lastTouchDistRef.current = getTouchDist(e.evt.touches);
      const rect = stageRef.current.container().getBoundingClientRect();
      lastTouchCenterRef.current = getTouchCenter(e.evt.touches, rect);
      return;
    }
    // Wall mode: only record where the pointer went down — the point is placed on tap-END,
    // so a pinch that starts a moment later never drops a stray point
    if (isWallMode && isPlanDoc) {
      if (e.target.name() === 'handle') return;
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
      const pos = getPointerPos(e); if (!pos) return;
      tapRef.current = { x: pos.x, y: pos.y, moved: false };
      return;
    }
    if (e.target.name() === 'handle' || e.target.name() === 'dim-group' || e.target.name() === 'polyline-group') return;

    // Calibration mode: place corner points
    if (isCalibMode) {
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
      const stage = stageRef.current; const pos = getPointerPos(e); if (!pos) return;
      const x = (pos.x - stage.x()) / stage.scaleX();
      const y = (pos.y - stage.y()) / stage.scaleY();
      if (calibPoints.length < 4) {
        const newPts = [...calibPoints, { x, y }];
        setCalibPoints(newPts);
        if (newPts.length === 4) {
          const dst = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 }];
          const H = computeHomography(newPts, dst);
          if (H) {
            updateDoc({ calibPoints: newPts, homography: H, globalRatio: null });
            setIsCalibMode(false);
            alert('✅ Đã hiệu chuẩn! Tất cả đo kích thước sẽ tự bù perspective.');
          } else {
            alert('❌ Không tính được. Hãy thử lại với 4 điểm rõ ràng hơn.');
            setCalibPoints([]);
          }
        }
      }
      return;
    }

    // Vertical edge mode: tap 2 points for VP3
    if (isVerticalMode) {
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
      const stage = stageRef.current; const pos = getPointerPos(e); if (!pos) return;
      const x = (pos.x - stage.x()) / stage.scaleX();
      const y = (pos.y - stage.y()) / stage.scaleY();
      const newPts = [...verticalPoints, { x, y }];
      setVerticalPoints(newPts);
      if (newPts.length === 2) {
        updateDoc({ verticalPoints: newPts });
        setIsVerticalMode(false);
        alert('✅ Đã thiết lập trục Z (VP3)! Lưới 3 trục đã cập nhật.');
      }
      return;
    }

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

    // Polyline mode
    if (isPolylineMode) {
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
      const stage = stageRef.current; const pos = getPointerPos(e); if (!pos) return;
      let x = (pos.x - stage.x()) / stage.scaleX();
      let y = (pos.y - stage.y()) / stage.scaleY();

      if (!activePolyline) {
        // First point
        setActivePolyline({ id: Date.now(), points: [{ x, y }], labels: [], ratio: null });
      } else {
        const pts = activePolyline.points;
        const lastPt = pts[pts.length - 1];
        // If more than 1 point, enforce perpendicularity
        if (pts.length >= 2) {
          const prevPt = pts[pts.length - 2];
          const snapped = getPerpendicularPoint(lastPt, prevPt, x, y);
          x = snapped.x; y = snapped.y;
        }
        const dist = Math.sqrt((x - lastPt.x) ** 2 + (y - lastPt.y) ** 2);
        if (dist > 5) {
          setActivePolyline({ ...activePolyline, points: [...pts, { x, y }] });
        }
      }
      return;
    }

    if (!isDrawingMode) { if (e.target === e.target.getStage() || e.target.className === 'Image' || e.target.name() === 'plan-grid') setSelectedId(null); return; }
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
    // Wall mode: track movement (>10px screen cancels the tap) + live preview from the chain anchor
    if (isWallMode && isPlanDoc) {
      const pos = getPointerPos(e); if (!pos) return;
      if (tapRef.current) {
        const d = Math.hypot(pos.x - tapRef.current.x, pos.y - tapRef.current.y);
        if (d > 10) tapRef.current.moved = true;
      }
      if (wallChain) {
        if (e.evt && e.evt.cancelable) e.evt.preventDefault();
        const stage = stageRef.current;
        const x = (pos.x - stage.x()) / stage.scaleX();
        const y = (pos.y - stage.y()) / stage.scaleY();
        setWallPreview(resolvePlanPoint({ x, y }, { x: wallChain.anchor.x, y: wallChain.anchor.y }));
      }
      return;
    }
    // Polyline preview
    if (isPolylineMode && activePolyline && activePolyline.points.length >= 1) {
      if (e.evt && e.evt.cancelable) e.evt.preventDefault();
      const stage = stageRef.current; const pos = getPointerPos(e); if (!pos) return;
      let x = (pos.x - stage.x()) / stage.scaleX();
      let y = (pos.y - stage.y()) / stage.scaleY();
      const pts = activePolyline.points;
      const lastPt = pts[pts.length - 1];
      if (pts.length >= 2) {
        const prevPt = pts[pts.length - 2];
        const snapped = getPerpendicularPoint(lastPt, prevPt, x, y);
        x = snapped.x; y = snapped.y;
      }
      setPolylinePreview({ x, y });
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

  const handleStageMouseUp = (e) => {
    // Reset pinch state
    const wasPinch = lastTouchDistRef.current !== null;
    lastTouchDistRef.current = null;
    lastTouchCenterRef.current = null;
    // Wall mode: place the point on tap-end (clean tap only — no drag, no pinch)
    if (isWallMode && isPlanDoc) {
      const t = tapRef.current;
      tapRef.current = null;
      if (!t || t.moved || wasPinch) return;
      if (e?.evt?.touches?.length > 0) return; // another finger still down
      const pos = getPointerPos(e) || { x: t.x, y: t.y };
      handleWallTap(pos);
      return;
    }
    if (!isDrawingMode || !tempLine || isEditFrameMode) return;
    const dx = tempLine.end.x - tempLine.start.x; const dy = tempLine.end.y - tempLine.start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 10) {
      let labelVal = Math.round(distance).toString();
      if (currentDoc.homography) {
        const realDist = measureRealDistance(currentDoc.homography, tempLine.start, tempLine.end);
        labelVal = (Math.round(realDist / 10) * 10).toString();
      } else if (currentDoc.globalRatio) { let rv = distance * currentDoc.globalRatio; rv = Math.round(rv / 10) * 10; labelVal = rv.toString(); }
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
  const getExportURI = (doc, format = 'png') => {
    const stage = stageRef.current;
    const oldScale = stage.scaleX(); const oldPos = stage.position();
    stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 });
    let cropBox, pixelRatio;
    if (doc.type === 'plan') {
      const bb = contentBBox(doc) || { x: 0, y: 0, width: 12000, height: 9000 };
      const margin = 500; // mm
      cropBox = { x: bb.x - margin, y: bb.y - margin, width: bb.width + 2 * margin, height: bb.height + 2 * margin };
      // World units are mm — scale output so the long edge lands around 3000 px
      pixelRatio = Math.min(3000 / Math.max(cropBox.width, cropBox.height), 4);
    } else {
      cropBox = { x: 0, y: 0, width: doc.img.width, height: doc.img.height };
      if (showFrame && customFrame && doc.frameAttrs) cropBox = { x: doc.frameAttrs.x, y: doc.frameAttrs.y, width: doc.frameAttrs.width, height: doc.frameAttrs.height };
      const maxDim = Math.max(cropBox.width, cropBox.height);
      // Upscale small photos to ~2560 px long edge, keep large ones native, cap at 4096 to avoid WebView OOM
      pixelRatio = maxDim > 4096 ? 4096 / maxDim : Math.min(Math.max(2560 / maxDim, 1), 2);
    }
    const uri = stage.toDataURL({ pixelRatio, mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png', quality: 0.92, ...cropBox });
    stage.scale({ x: oldScale, y: oldScale }); stage.position(oldPos);
    return uri;
  };

  const handleExportDxf = async (doc) => {
    if (!requireFeature('dxfExport')) return;
    try {
      const dxfStr = generateDxf(doc);
      const fileName = `DIM_${doc.name.replace(/\.[^/.]+$/, "")}_${Date.now()}.dxf`;
      if (Capacitor.isNativePlatform()) {
        let permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== 'granted') {
          permStatus = await Filesystem.requestPermissions();
          if (permStatus.publicStorage !== 'granted') { alert('Cần cấp quyền lưu trữ để lưu file!'); return; }
        }
        await Filesystem.writeFile({ path: fileName, data: dxfStr, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
        alert('Đã lưu file DXF vào thư mục Documents!\nMở bằng AutoCAD — đơn vị: mm.');
      } else {
        const blob = new Blob([dxfStr], { type: 'application/dxf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.download = fileName; link.href = url; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) { alert('Lỗi xuất DXF: ' + err.message); }
  };

  const executeDownload = async (doc, isBatch = false, format = 'png') => {
    setSelectedId(null); setIsEditFrameMode(false); setWallChain(null); setWallPreview(null);
    return new Promise(resolve => {
      setTimeout(async () => {
        try {
          const uri = getExportURI(doc, format);
          const ext = format === 'jpg' ? 'jpg' : 'png';
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
            const fileName = `DIM_${doc.name.replace(/\.[^/.]+$/, "")}_${Date.now()}.${ext}`;
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
            const webName = doc.type === 'plan' ? `[DIM]_${doc.name}.${ext}` : `[DIM]_${doc.name}`;
            const link = document.createElement('a'); link.download = webName; link.href = uri; link.click();
            // Auto-upload to Google Drive for web too
            if (GDrive.isConnected() && localStorage.getItem('gdrive_auto_upload') === 'true') {
              try {
                const base64Data = uri.split(',')[1];
                const projectName = projects.find(p => p.id === currentProjectId)?.name || '';
                await GDrive.uploadImage(base64Data, webName, projectName);
              } catch (driveErr) { console.warn('GDrive upload failed:', driveErr); }
            }
          }
        } catch (err) { if (!isBatch) alert("Lỗi lưu ảnh: " + err.message); }
        resolve();
      }, 100);
    });
  };

  const handleShare = async (doc) => {
    setSelectedId(null); setIsEditFrameMode(false); setWallChain(null); setWallPreview(null);
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

  // === Multi-select save ===
  const handleSelectSave = async () => {
    if (selectedDocs.size === 0) return;
    const docsToSave = docs.filter(d => selectedDocs.has(d.id));
    setIsExportingAll(true);
    for (let i = 0; i < docsToSave.length; i++) {
      setActiveDocId(docsToSave[i].id);
      await new Promise(resolve => setTimeout(resolve, 300));
      await executeDownload(docsToSave[i], true);
    }
    setActiveDocId(null);
    setIsExportingAll(false);
    setSelectMode(false);
    setSelectedDocs(new Set());
    if (Capacitor.isNativePlatform()) alert(`Đã lưu ${docsToSave.length} ảnh!`);
  };

  const toggleSelectDoc = (docId) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedDocs.size === docs.length) setSelectedDocs(new Set());
    else setSelectedDocs(new Set(docs.map(d => d.id)));
  };

  // === GDrive Sync ===
  const handleSync = async () => {
    if (!GDrive.isConnected()) { alert('Vui lòng kết nối Google Drive trong Cài đặt trước!'); return; }
    if (docs.length === 0) { alert('Chưa có ảnh để sync!'); return; }
    const projectName = projects.find(p => p.id === currentProjectId)?.name || '';
    setSyncing(true); setSyncProgress('Đang kiểm tra folder...');
    try {
      const driveFiles = await GDrive.listFiles(projectName);
      const driveNames = new Set(driveFiles.map(f => f.name));
      const missingDocs = docs.filter(d => {
        const dimName = `DIM_${d.name.replace(/\.[^/.]+$/, "")}`;
        return !driveNames.has(d.name) && !driveNames.has(dimName + '.png') && !driveNames.has(`[DIM]_${d.name}`);
      });
      if (missingDocs.length === 0) {
        setSyncProgress(''); setSyncing(false);
        alert('Tất cả ảnh đã được sync!'); return;
      }
      for (let i = 0; i < missingDocs.length; i++) {
        const doc = missingDocs[i];
        setSyncProgress(`Đang upload ${i + 1}/${missingDocs.length}: ${doc.name}`);
        // Set active doc to render then export
        setActiveDocId(doc.id);
        await new Promise(resolve => setTimeout(resolve, 400));
        const uri = getExportURI(doc);
        const b64 = uri.split(',')[1];
        const fileName = `[DIM]_${doc.name}`;
        await GDrive.uploadImage(b64, fileName, projectName);
      }
      setActiveDocId(null);
      setSyncProgress(''); setSyncing(false);
      alert(`Đã sync ${missingDocs.length} ảnh lên Google Drive!`);
    } catch (err) {
      setSyncProgress(''); setSyncing(false);
      alert('Lỗi sync: ' + err.message);
    }
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
                {doc.img ? <img src={doc.img.src} alt="thumb" /> : <div className="plan-thumb">📐</div>}
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
            {isPlanDoc && (
              <>
                <button className="btn" onClick={() => { const next = !isWallMode; setIsWallMode(next); setIsEditKTMode(false); setWallChain(null); setWallPreview(null); setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsEditFrameMode(false); document.body.style.cursor = next ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isWallMode ? '#e0e7ff' : 'transparent', color: isWallMode ? '#4f46e5' : '#475569' }}><BrickWall size={18} /> {isWallMode ? (wallChain ? 'Chạm tiếp / ESC hủy' : 'Chạm điểm đầu...') : 'Vẽ tường'}</button>
                {isWallMode && wallChain && <button className="btn" onClick={finishWallChain} style={{ background: '#10b981', color: '#fff', fontWeight: 600 }}>✓ Xong</button>}
                {!isWallMode && currentDoc?.plan?.walls?.length > 0 && (
                  <button className="btn" onClick={() => { setIsEditKTMode(v => !v); setSelectedId(null); setIsPlaceDoorMode(false); setIsPlaceWindowMode(false); }} style={{ background: isEditKTMode ? '#fef9c3' : 'transparent', color: isEditKTMode ? '#b45309' : '#475569', border: isEditKTMode ? '1px solid #fde68a' : 'none' }}>✏️ {isEditKTMode ? 'Đang sửa KT' : 'Sửa KT'}</button>
                )}
                {!isWallMode && currentDoc?.plan?.walls?.length > 0 && (
                  <>
                    <button className="btn" onClick={() => { setIsPlaceDoorMode(v => !v); setIsPlaceWindowMode(false); setIsEditKTMode(false); setSelectedId(null); setSelectedOpeningId(null); }} style={{ background: isPlaceDoorMode ? '#fce7f3' : 'transparent', color: isPlaceDoorMode ? '#be185d' : '#475569', border: isPlaceDoorMode ? '1px solid #fbcfe8' : 'none' }}>🚪 {isPlaceDoorMode ? 'Chạm tường...' : 'Cửa đi'}</button>
                    <button className="btn" onClick={() => { setIsPlaceWindowMode(v => !v); setIsPlaceDoorMode(false); setIsEditKTMode(false); setSelectedId(null); setSelectedOpeningId(null); }} style={{ background: isPlaceWindowMode ? '#ecfdf5' : 'transparent', color: isPlaceWindowMode ? '#059669' : '#475569', border: isPlaceWindowMode ? '1px solid #6ee7b7' : 'none' }}>🪟 {isPlaceWindowMode ? 'Chạm tường...' : 'Cửa sổ'}</button>
                  </>
                )}
              </>
            )}
            <button className="btn" onClick={() => { setIsDrawingMode(!isDrawingMode); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsEditFrameMode(false); setIsWallMode(false); setWallChain(null); setWallPreview(null); document.body.style.cursor = !isDrawingMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isDrawingMode ? '#fef08a' : 'transparent', color: isDrawingMode ? '#ca8a04' : '#475569' }}><PencilRuler size={18} /> {isDrawingMode ? 'Đang vẽ...' : 'Vẽ Dim'}</button>
            {!isPlanDoc && (
              <>
                <button className="btn" onClick={() => { const next = !isPolylineMode; setIsPolylineMode(next); setIsDrawingMode(false); setIsTextMode(false); setIsEditFrameMode(false); if (!next) { if (activePolyline && activePolyline.points.length >= 2) finishPolyline(); else { setActivePolyline(null); setPolylinePreview(null); } } document.body.style.cursor = next ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isPolylineMode ? '#d1fae5' : 'transparent', color: isPolylineMode ? '#059669' : '#475569' }}><PencilRuler size={18} /> {isPolylineMode ? (activePolyline ? 'Click tiếp / ESC xong' : 'Đang chờ...') : 'Đo phòng'}</button>
                {isPolylineMode && activePolyline && activePolyline.points.length >= 2 && <button className="btn" onClick={finishPolyline} style={{ background: '#10b981', color: '#fff', fontWeight: 600 }}>✓ Xong</button>}
                <button className="btn" onClick={handleMagicDim} style={{ color: canUse('magicDim') ? '#d946ef' : '#94a3b8' }}>{!canUse('magicDim') && <Crown size={14} color="#eab308" />}<Wand2 size={18} /> Magic Dim</button>
              </>
            )}
            <button className="btn" onClick={() => { setIsTextMode(!isTextMode); setIsDrawingMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsEditFrameMode(false); setIsWallMode(false); setWallChain(null); setWallPreview(null); document.body.style.cursor = !isTextMode ? 'text' : 'default'; setSelectedId(null); }} style={{ background: isTextMode ? '#dbeafe' : 'transparent', color: isTextMode ? '#2563eb' : '#475569' }}><Type size={18} /> {isTextMode ? 'Đang ghi chú...' : 'Ghi chú'}</button>
            {!isPlanDoc && (
              <>
                <button className="btn" onClick={() => { const next = !isCalibMode; setIsCalibMode(next); setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsVerticalMode(false); setIsEditFrameMode(false); if (next) { setCalibPoints([]); } else { setCalibPoints([]); } document.body.style.cursor = next ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isCalibMode ? '#fef3c7' : (currentDoc.homography ? '#d1fae5' : 'transparent'), color: isCalibMode ? '#d97706' : (currentDoc.homography ? '#059669' : '#475569') }}><Crosshair size={18} /> {isCalibMode ? `Chọn góc ${calibPoints.length + 1}/4` : (currentDoc.homography ? '✓ Đã chuẩn' : 'Tấm chuẩn')}</button>
                {currentDoc.homography && !isCalibMode && <button className="btn" onClick={() => { updateDoc({ calibPoints: null, homography: null }); setCalibPoints([]); }} style={{ color: '#ef4444', fontSize: 11, padding: '4px 8px' }}>Xóa chuẩn</button>}
                {currentDoc.homography && !isCalibMode && (
                  <button className="btn" onClick={() => { setIsVerticalMode(!isVerticalMode); setIsCalibMode(false); setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); if (!isVerticalMode) { setVerticalPoints([]); } document.body.style.cursor = !isVerticalMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isVerticalMode ? '#f3e8ff' : (currentDoc.verticalPoints ? '#ede9fe' : 'transparent'), color: isVerticalMode ? '#7c3aed' : (currentDoc.verticalPoints ? '#7c3aed' : '#475569') }}>
                    📏 {isVerticalMode ? `Chọn điểm ${verticalPoints.length + 1}/2` : (currentDoc.verticalPoints ? '✓ Trục Z' : '+ Trục Z')}
                  </button>
                )}
                {currentDoc.verticalPoints && !isVerticalMode && <button className="btn" onClick={() => { updateDoc({ verticalPoints: null }); setVerticalPoints([]); }} style={{ color: '#a855f7', fontSize: 11, padding: '4px 8px' }}>Xóa Z</button>}
                <div className="divider"></div>
                <button className="btn" onClick={() => { setShowFrame(!showFrame); setIsEditFrameMode(false); }} style={{ background: showFrame ? '#fee2e2' : 'transparent', color: showFrame ? '#b91c1c' : '#475569' }}><Frame size={18} /> {showFrame ? 'Tắt Khung' : 'Bật Khung'}</button>
                {showFrame && customFrame && (
                  <button className="btn" onClick={() => { setIsEditFrameMode(!isEditFrameMode); setIsDrawingMode(false); setIsTextMode(false); document.body.style.cursor = 'default'; }} style={{ background: isEditFrameMode ? '#dbeafe' : 'transparent', color: isEditFrameMode ? '#1d4ed8' : '#475569', border: isEditFrameMode ? '1px solid #93c5fd' : 'none' }}>
                    {isEditFrameMode ? <Lock size={18} /> : <Unlock size={18} />} Khóa/Mở
                  </button>
                )}
                <div className="divider"></div>
                <button className="btn" onClick={() => { setSelectedId(null); setIsEditFrameMode(false); setTimeout(() => executeDownload(currentDoc), 100); }}><Download size={18} /> Lưu ảnh</button>
              </>
            )}
            {isPlanDoc && (
              <>
                <div className="divider"></div>
                <button className="btn" onClick={() => { setSelectedId(null); setWallChain(null); setWallPreview(null); setTimeout(() => executeDownload(currentDoc, false, 'png'), 100); }} style={{ color: '#059669' }}><Download size={18} /> PNG</button>
                <button className="btn" onClick={() => { setSelectedId(null); setWallChain(null); setWallPreview(null); setTimeout(() => executeDownload(currentDoc, false, 'jpg'), 100); }} style={{ color: '#2563eb' }}><Download size={18} /> JPG</button>
                <button className="btn" onClick={() => handleExportDxf(currentDoc)} style={{ color: canUse('dxfExport') ? '#7c3aed' : '#94a3b8' }}>{!canUse('dxfExport') && <Crown size={14} color="#eab308" />}<FileDown size={18} /> DXF</button>
              </>
            )}
          </div>
        )}

        {!currentDoc ? (
          <div className="gallery-view">
            <div className="gallery-header">
              <button className="btn btn-icon" onClick={() => { setCurrentProjectId(null); setSelectMode(false); setSelectedDocs(new Set()); }} style={{ padding: 4 }}><ArrowLeft size={20} /></button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 'bold', fontSize: 16 }}>{currentProject?.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectMode ? `Đã chọn ${selectedDocs.size}/${docs.length}` : `${docs.length} ảnh`}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {docs.length > 0 && !selectMode && (
                  <>
                    <button className="btn btn-icon" onClick={() => { setSelectMode(true); setSelectedDocs(new Set()); }} style={{ padding: 6, background: '#ecfdf5', border: '1px solid #34d399' }} title="Lưu ảnh"><Download size={18} color="#059669" /></button>
                    <button className="btn btn-icon" onClick={handleSync} disabled={syncing} style={{ padding: 6, background: '#eff6ff', border: '1px solid #93c5fd' }} title="Sync Google Drive"><RefreshCw size={18} color="#2563eb" className={syncing ? 'spin-icon' : ''} /></button>
                  </>
                )}
                {selectMode && (
                  <button className="btn" onClick={() => { setSelectMode(false); setSelectedDocs(new Set()); }} style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444' }}><X size={16} /> Hủy</button>
                )}
                {!selectMode && (
                  <>
                    <div className="file-input-wrapper">
                      <button className="btn btn-primary" style={{ padding: '8px 14px' }}><Camera size={18} /> {isMobile ? '' : 'Chụp'}</button>
                      <input type="file" onChange={handleUpload} accept="image/*" capture="environment" />
                    </div>
                    <div className="file-input-wrapper">
                      <button className="btn" style={{ padding: '8px 14px', border: '1px solid #cbd5e1' }}><ImagePlus size={18} /> {isMobile ? '' : 'Thư viện'}</button>
                      <input type="file" multiple onChange={handleUpload} accept="image/*" />
                    </div>
                    <button className="btn" style={{ padding: '8px 14px', border: '1px solid #0ea5e9', background: '#f0f9ff', color: '#0284c7' }} onClick={handleCreatePlanDoc}><BrickWall size={18} /> {isMobile ? '' : '+ Mặt bằng'}</button>
                    {Capacitor.isNativePlatform() && (
                      <button className="btn" style={{ padding: '8px 14px', border: '1px solid #6366f1', background: '#eef2ff', color: '#4f46e5' }} onClick={handleARScan}><Scan size={18} /> {isMobile ? '' : 'AR'}</button>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Sync progress bar */}
            {syncing && syncProgress && (
              <div className="sync-progress-bar">
                <RefreshCw size={14} className="spin-icon" /> {syncProgress}
              </div>
            )}
            {docs.length === 0 ? (
              <div className="empty-state">
                <div className="upload-box">
                  <Camera size={64} style={{ marginBottom: 10, color: '#3b82f6' }} />
                  <h2 style={{ fontSize: '18px', margin: '5px 0' }}>Chụp ảnh hoặc Tải ảnh lên</h2>
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>Chạm nút bên dưới để bắt đầu</p>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <div className="file-input-wrapper">
                      <button className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 14 }}><Camera size={18} /> Chụp ảnh</button>
                      <input type="file" onChange={handleUpload} accept="image/*" capture="environment" />
                    </div>
                    <div className="file-input-wrapper">
                      <button className="btn" style={{ padding: '10px 20px', fontSize: 14, border: '1px solid #cbd5e1' }}><ImagePlus size={18} /> Thư viện</button>
                      <input type="file" multiple onChange={handleUpload} accept="image/*" />
                    </div>
                    <button className="btn" onClick={handleCreatePlanDoc} style={{ padding: '10px 20px', fontSize: 14, border: '1px solid #0ea5e9', background: '#f0f9ff', color: '#0284c7' }}><BrickWall size={18} /> Vẽ mặt bằng</button>
                    {Capacitor.isNativePlatform() && (
                      <button className="btn" onClick={handleARScan} style={{ padding: '10px 20px', fontSize: 14, border: '1px solid #6366f1', background: '#eef2ff', color: '#4f46e5' }}><Scan size={18} /> Quét AR</button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="gallery-grid">
                {docs.map(doc => (
                  <div key={doc.id} className={`gallery-item ${selectMode && selectedDocs.has(doc.id) ? 'selected' : ''}`}
                    onClick={() => selectMode ? toggleSelectDoc(doc.id) : setActiveDocId(doc.id)}>
                    {doc.img ? <img src={doc.img.src} alt={doc.name} /> : <div className="plan-thumb gallery-plan-thumb">📐</div>}
                    {selectMode && (
                      <div className="select-overlay">
                        {selectedDocs.has(doc.id) ? <CheckSquare size={24} color="#2563eb" /> : <Square size={24} color="#94a3b8" />}
                      </div>
                    )}
                    <div className="gallery-item-name">{doc.name}</div>
                  </div>
                ))}
              </div>
            )}
            {/* Select mode bottom bar */}
            {selectMode && docs.length > 0 && (
              <div className="gallery-select-bar">
                <button className="btn" onClick={selectAll} style={{ fontSize: 13 }}>
                  {selectedDocs.size === docs.length ? <CheckSquare size={18} color="#2563eb" /> : <Square size={18} />}
                  {selectedDocs.size === docs.length ? 'Bỏ chọn' : 'Chọn tất cả'}
                </button>
                <button className="btn btn-primary" onClick={handleSelectSave} disabled={selectedDocs.size === 0 || isExportingAll}
                  style={{ padding: '10px 20px', fontSize: 14, borderRadius: 12 }}>
                  <Download size={18} /> {isExportingAll ? 'Đang lưu...' : `Lưu ${selectedDocs.size} ảnh`}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {!isMobile && (
              <div className="hint-text">
                {isPlanDoc
                  ? (isWallMode ? (wallChain ? 'Chạm điểm tiếp theo • ESC hủy chain • ✓ Xong kết thúc' : 'Chạm điểm đầu tiên để bắt đầu vẽ tường') : isEditKTMode ? 'Chạm vào tường để nhập kích thước • Tường đỏ = đã sửa • Bấm ✏️ để thoát' : isPlaceDoorMode ? 'Chạm vào tường để đặt cửa đi (900mm) • ESC để hủy' : isPlaceWindowMode ? 'Chạm vào tường để đặt cửa sổ (1200mm) • ESC để hủy' : 'Chọn "Vẽ tường" • Bấm ✏️ Sửa KT để nhập kích thước tường')
                  : isPolylineMode ? (activePolyline ? 'Click để thêm điểm (vuông góc tự động) | ESC / nút Xong để kết thúc' : 'Click để đặt điểm đầu tiên') : isDrawingMode ? 'Kéo chuột để vẽ (Giữ SHIFT để khóa trục)' : isTextMode ? 'Click vào ảnh để đặt ghi chú' : 'Ctrl+Z (Undo) | Ctrl+Y (Redo) | Ctrl+C/V | Delete'}
              </div>
            )}
            {isPlanDoc && isWallMode && (
              <PlanSettingsBar
                settings={currentDoc.planSettings || { wallThickness: 110, orthoMode: true, gridSnap: true }}
                onChange={(s) => updateDoc({ planSettings: s })}
                onUndo={doUndo}
                onRedo={doRedo}
                canUndo={currentDoc.historyStep > 0}
                canRedo={currentDoc.historyStep < currentDoc.linesHistory.length - 1}
              />
            )}
            <Stage width={stageSize.width} height={stageSize.height} ref={stageRef} scaleX={currentDoc.stageScale} scaleY={currentDoc.stageScale} x={currentDoc.stagePos.x} y={currentDoc.stagePos.y}
              draggable={false}
              onWheel={handleWheel}
              onMouseDown={handleStageMouseDown} onMouseMove={handleStageMouseMove} onMouseUp={handleStageMouseUp}
              onTouchStart={handleStageMouseDown} onTouchMove={handleStageMouseMove} onTouchEnd={handleStageMouseUp}
            >
              <Layer>
                {isPlanDoc ? (
                  <PlanGrid
                    stageScale={currentDoc.stageScale}
                    stagePos={currentDoc.stagePos}
                    stageSize={stageSize}
                    contentBounds={contentBBox(currentDoc)}
                    gridMinor={(currentDoc.planSettings || {}).gridMinor || 100}
                    gridMajor={(currentDoc.planSettings || {}).gridMajor || 1000}
                  />
                ) : (
                  <KonvaImage image={currentDoc.img} x={0} y={0} />
                )}
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
                {/* Polylines */}
                {(currentDoc.polylines || []).map(poly => (
                  <PolylineDimGroup key={poly.id} polyline={poly} stageScale={currentDoc.stageScale} isSelected={poly.id === selectedId} onSelect={setSelectedId} onLabelEdit={handlePolylineLabelEdit}
                    onChange={(newVal, commit = false) => {
                      const newPolys = (currentDoc.polylines || []).map(p => p.id === newVal.id ? newVal : p);
                      if (commit) commitHistory(currentDoc.lines, currentDoc.texts || [], newPolys); else updateDoc({ polylines: newPolys });
                    }}
                  />
                ))}
                {/* Active polyline preview */}
                {activePolyline && activePolyline.points.length >= 1 && (
                  <>
                    {activePolyline.points.map((p, i) => {
                      if (i === 0) return null;
                      const prev = activePolyline.points[i - 1];
                      return <KonvaLine key={`ap-${i}`} points={[prev.x, prev.y, p.x, p.y]} stroke="#10b981" strokeWidth={2 / currentDoc.stageScale} />;
                    })}
                    {polylinePreview && (
                      <KonvaLine points={[activePolyline.points[activePolyline.points.length - 1].x, activePolyline.points[activePolyline.points.length - 1].y, polylinePreview.x, polylinePreview.y]} stroke="#10b981" strokeWidth={2 / currentDoc.stageScale} dash={[6 / currentDoc.stageScale, 6 / currentDoc.stageScale]} />
                    )}
                    {activePolyline.points.map((p, i) => (
                      <Circle key={`apc-${i}`} x={p.x} y={p.y} radius={5 / currentDoc.stageScale} fill="#10b981" stroke="#fff" strokeWidth={1.5 / currentDoc.stageScale} listening={false} />
                    ))}
                  </>
                )}
                {tempLine && <KonvaLine points={[tempLine.start.x, tempLine.start.y, tempLine.end.x, tempLine.end.y]} stroke="#eab308" strokeWidth={2 / currentDoc.stageScale} dash={[5 / currentDoc.stageScale, 5 / currentDoc.stageScale]} />}
                {/* Plan layers */}
                {isPlanDoc && currentDoc.plan && (
                  <>
                    <WallsLayer plan={currentDoc.plan} stageScale={currentDoc.stageScale} selectedId={selectedId} interactive={!isWallMode}
                      onSelect={(id) => { setSelectedId(id); setSelectedOpeningId(null); }}
                      onLabelEdit={handleWallLabelEdit} onNodeDrag={handleNodeDrag} snapFn={planSnapFn}
                      editKTMode={isEditKTMode}
                      placeOpeningType={isPlaceDoorMode ? 'door' : isPlaceWindowMode ? 'window' : null}
                      onPlaceOpening={handlePlaceOpening}
                      onSelectOpening={handleSelectOpening}
                      selectedOpeningId={selectedOpeningId?.openingId}
                    />
                    <RoomLabels plan={currentDoc.plan} stageScale={currentDoc.stageScale} interactive={!isWallMode} onRename={handleRoomRename} />
                    <WallDrawPreview anchor={wallChain?.anchor} preview={wallPreview} thickness={(currentDoc.planSettings || {}).wallThickness || 110} stageScale={currentDoc.stageScale} />
                  </>
                )}
                {/* Photo-only overlays */}
                {!isPlanDoc && (
                  <>
                    {customWatermark ? (
                      <KonvaImage image={customWatermark} x={currentDoc.img.width / 2} y={currentDoc.img.height / 2} offsetX={customWatermark.width / 2} offsetY={customWatermark.height / 2} scaleX={(currentDoc.img.width * 0.4) / customWatermark.width} scaleY={(currentDoc.img.width * 0.4) / customWatermark.width} opacity={0.3} listening={false} />
                    ) : watermarkTxt ? (
                      <Group x={currentDoc.img.width / 2} y={currentDoc.img.height / 2} rotation={-25} listening={false}>
                        <Text x={-currentDoc.img.width} y={-currentDoc.img.width * 0.05} width={currentDoc.img.width * 2} text={watermarkTxt} fontSize={Math.max(currentDoc.img.width / 12, 50)} fill="rgba(255,255,255,0.35)" stroke="rgba(0,0,0,0.15)" strokeWidth={3} align="center" fontStyle="bold" fontFamily="Inter" />
                      </Group>
                    ) : null}
                    {(currentDoc.calibPoints || calibPoints.length > 0) && (
                      <CalibrationOverlay
                        calibPoints={currentDoc.calibPoints || calibPoints}
                        verticalPoints={currentDoc.verticalPoints || (verticalPoints.length > 0 ? verticalPoints : null)}
                        stageScale={currentDoc.stageScale}
                        isCalibrating={isCalibMode}
                        isVerticalMode={isVerticalMode}
                        onPointDrag={(idx, pos, commit) => {
                          if (currentDoc.calibPoints) {
                            const newPts = currentDoc.calibPoints.map((p, i) => i === idx ? pos : p);
                            const dst = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 }];
                            const H = computeHomography(newPts, dst);
                            if (H) updateDoc({ calibPoints: newPts, homography: H });
                          } else {
                            setCalibPoints(prev => prev.map((p, i) => i === idx ? pos : p));
                          }
                        }}
                      />
                    )}
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
                  </>
                )}
              </Layer>
            </Stage>

            {/* Floating toolbar */}
            {selectedOpeningId && !isMobile && (
              <div className="floating-dim-toolbar">
                <button className="btn btn-icon" onClick={handleOpeningLabelEdit}><Edit3 size={18} color="#2563eb" /> <span style={{ fontSize: 12, marginLeft: 6, color: '#2563eb', fontWeight: 600 }}>Sửa KT</span></button>
                <div style={{ width: 1, backgroundColor: '#e2e8f0', height: 20, margin: '0 8px' }}></div>
                <button className="btn btn-icon" onClick={handleDeleteOpening}><Trash2 size={18} color="#ef4444" /> <span style={{ fontSize: 12, marginLeft: 6, color: '#ef4444', fontWeight: 600 }}>Xóa</span></button>
              </div>
            )}
            {selectedOpeningId && isMobile && (
              <div className="floating-dim-toolbar mobile-floating">
                <button className="btn btn-icon" style={{ flexDirection: 'column', gap: 4 }} onClick={handleOpeningLabelEdit}><Edit3 size={20} color="#2563eb" /> <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 600 }}>Sửa</span></button>
                <div style={{ width: 1, backgroundColor: '#e2e8f0', height: 24, margin: '0 12px' }}></div>
                <button className="btn btn-icon" style={{ flexDirection: 'column', gap: 4 }} onClick={handleDeleteOpening}><Trash2 size={20} color="#ef4444" /> <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>Xóa</span></button>
              </div>
            )}
            {selectedId && !isMobile && (
              <div className="floating-dim-toolbar">
                <button className="btn btn-icon" onClick={() => {
                  const wall = currentDoc.plan?.walls.find(w => w.id === selectedId);
                  const line = currentDoc.lines.find(l => l.id === selectedId);
                  const note = (currentDoc.texts || []).find(t => t.id === selectedId);
                  const poly = (currentDoc.polylines || []).find(p => p.id === selectedId);
                  if (wall) handleWallLabelEdit(selectedId);
                  else if (line) handleTextEdit(line);
                  else if (note) handleTextNoteEdit(note);
                  else if (poly) handlePolylineLabelEdit(poly.id, 0);
                }}><Edit3 size={18} color="#2563eb" /> <span style={{ fontSize: 12, marginLeft: 6, color: '#2563eb', fontWeight: 600 }}>Sửa</span></button>
                <div style={{ width: 1, backgroundColor: '#e2e8f0', height: 20, margin: '0 8px' }}></div>
                <button className="btn btn-icon" onClick={() => {
                  const isWall = !!(currentDoc.plan?.walls.some(w => w.id === selectedId));
                  const isLine = currentDoc.lines.some(l => l.id === selectedId);
                  const isPoly = (currentDoc.polylines || []).some(p => p.id === selectedId);
                  if (isWall) handleDeleteWall(selectedId);
                  else if (isLine) commitHistory(currentDoc.lines.filter(l => l.id !== selectedId), currentDoc.texts || []);
                  else if (isPoly) commitHistory(currentDoc.lines, currentDoc.texts || [], (currentDoc.polylines || []).filter(p => p.id !== selectedId));
                  else { commitHistory(currentDoc.lines, (currentDoc.texts || []).filter(t => t.id !== selectedId)); setSelectedId(null); }
                }}><Trash2 size={18} color="#ef4444" /> <span style={{ fontSize: 12, marginLeft: 6, color: '#ef4444', fontWeight: 600 }}>Xóa</span></button>
              </div>
            )}
            {selectedId && isMobile && (
              <div className="floating-dim-toolbar mobile-floating">
                <button className="btn btn-icon" style={{ flexDirection: 'column', gap: 4 }} onClick={() => {
                  const wall = currentDoc.plan?.walls.find(w => w.id === selectedId);
                  const line = currentDoc.lines.find(l => l.id === selectedId);
                  const note = (currentDoc.texts || []).find(t => t.id === selectedId);
                  const poly = (currentDoc.polylines || []).find(p => p.id === selectedId);
                  if (wall) handleWallLabelEdit(selectedId);
                  else if (line) handleTextEdit(line);
                  else if (note) handleTextNoteEdit(note);
                  else if (poly) handlePolylineLabelEdit(poly.id, 0);
                }}><Edit3 size={20} color="#2563eb" /> <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 600 }}>Sửa</span></button>
                <div style={{ width: 1, backgroundColor: '#e2e8f0', height: 24, margin: '0 12px' }}></div>
                <button className="btn btn-icon" style={{ flexDirection: 'column', gap: 4 }} onClick={() => {
                  const isWall = !!(currentDoc.plan?.walls.some(w => w.id === selectedId));
                  const isLine = currentDoc.lines.some(l => l.id === selectedId);
                  const isPoly = (currentDoc.polylines || []).some(p => p.id === selectedId);
                  if (isWall) handleDeleteWall(selectedId);
                  else if (isLine) commitHistory(currentDoc.lines.filter(l => l.id !== selectedId), currentDoc.texts || []);
                  else if (isPoly) commitHistory(currentDoc.lines, currentDoc.texts || [], (currentDoc.polylines || []).filter(p => p.id !== selectedId));
                  else { commitHistory(currentDoc.lines, (currentDoc.texts || []).filter(t => t.id !== selectedId)); setSelectedId(null); }
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
            {isPlanDoc ? (
              <>
                <button className={`btn btn-icon ${isWallMode ? 'active-tool' : ''}`}
                  onClick={() => { const next = !isWallMode; setIsWallMode(next); setIsEditKTMode(false); setWallChain(null); setWallPreview(null); setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); document.body.style.cursor = next ? 'crosshair' : 'default'; setSelectedId(null); }}
                  style={{ background: isWallMode ? '#e0e7ff' : 'transparent', color: isWallMode ? '#4f46e5' : '#475569' }}><BrickWall size={22} /></button>
                {isWallMode && wallChain && <button className="btn btn-icon" onClick={finishWallChain} style={{ background: '#10b981', color: '#fff', borderRadius: 12 }}>✓</button>}
                {!isWallMode && currentDoc?.plan?.walls?.length > 0 && (
                  <>
                    <button className="btn btn-icon" onClick={() => { setIsEditKTMode(v => !v); setSelectedId(null); setIsPlaceDoorMode(false); setIsPlaceWindowMode(false); }}
                      style={{ background: isEditKTMode ? '#fef9c3' : 'transparent', color: isEditKTMode ? '#b45309' : '#475569', border: isEditKTMode ? '1px solid #fde68a' : 'none', fontSize: 18 }}>✏️</button>
                    <button className="btn btn-icon" onClick={() => { setIsPlaceDoorMode(v => !v); setIsPlaceWindowMode(false); setIsEditKTMode(false); setSelectedId(null); setSelectedOpeningId(null); }}
                      style={{ background: isPlaceDoorMode ? '#fce7f3' : 'transparent', color: isPlaceDoorMode ? '#be185d' : '#475569', border: isPlaceDoorMode ? '1px solid #fbcfe8' : 'none', fontSize: 18 }}>🚪</button>
                    <button className="btn btn-icon" onClick={() => { setIsPlaceWindowMode(v => !v); setIsPlaceDoorMode(false); setIsEditKTMode(false); setSelectedId(null); setSelectedOpeningId(null); }}
                      style={{ background: isPlaceWindowMode ? '#ecfdf5' : 'transparent', color: isPlaceWindowMode ? '#059669' : '#475569', border: isPlaceWindowMode ? '1px solid #6ee7b7' : 'none', fontSize: 18 }}>🪟</button>
                  </>
                )}
                <div className="divider"></div>
                <button className={`btn btn-icon ${isDrawingMode ? 'active-tool' : ''}`} onClick={() => { setIsDrawingMode(!isDrawingMode); setIsTextMode(false); setIsWallMode(false); setWallChain(null); setWallPreview(null); document.body.style.cursor = !isDrawingMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isDrawingMode ? '#fef08a' : 'transparent', color: isDrawingMode ? '#ca8a04' : '#475569' }}><PencilRuler size={22} /></button>
                <button className={`btn btn-icon ${isTextMode ? 'active-tool' : ''}`} onClick={() => { setIsTextMode(!isTextMode); setIsDrawingMode(false); setIsWallMode(false); setWallChain(null); setWallPreview(null); document.body.style.cursor = !isTextMode ? 'text' : 'default'; setSelectedId(null); }} style={{ background: isTextMode ? '#dbeafe' : 'transparent', color: isTextMode ? '#2563eb' : '#475569' }}><Type size={22} /></button>
                <div className="divider"></div>
                <button className="btn btn-icon" onClick={() => { setSelectedId(null); setWallChain(null); setWallPreview(null); setTimeout(() => executeDownload(currentDoc, false, 'png'), 100); }}><Download size={22} color="#059669" /></button>
                <button className="btn btn-icon" onClick={() => handleExportDxf(currentDoc)} style={{ color: canUse('dxfExport') ? '#7c3aed' : '#94a3b8', position: 'relative' }}><FileDown size={22} />{!canUse('dxfExport') && <Crown size={10} color="#eab308" style={{ position: 'absolute', top: 4, right: 4 }} />}</button>
              </>
            ) : (
              <>
                <div className="file-input-wrapper"><button className="btn btn-icon btn-primary"><Camera size={22} /></button><input type="file" onChange={handleUpload} accept="image/*" capture="environment" /></div>
                <div className="file-input-wrapper"><button className="btn btn-icon" style={{ border: '1px dashed #cbd5e1' }}><ImagePlus size={22} /></button><input type="file" multiple onChange={handleUpload} accept="image/*" /></div>
                <div className="divider"></div>
                <button className={`btn btn-icon ${isDrawingMode ? 'active-tool' : ''}`} onClick={() => { setIsDrawingMode(!isDrawingMode); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsEditFrameMode(false); document.body.style.cursor = !isDrawingMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isDrawingMode ? '#fef08a' : 'transparent', color: isDrawingMode ? '#ca8a04' : '#475569' }}><PencilRuler size={22} /></button>
                <button className={`btn btn-icon ${isPolylineMode ? 'active-tool' : ''}`} onClick={() => { const next = !isPolylineMode; setIsPolylineMode(next); setIsDrawingMode(false); setIsTextMode(false); setIsEditFrameMode(false); if (!next) { if (activePolyline && activePolyline.points.length >= 2) finishPolyline(); else { setActivePolyline(null); setPolylinePreview(null); } } document.body.style.cursor = next ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isPolylineMode ? '#d1fae5' : 'transparent', color: isPolylineMode ? '#059669' : '#475569' }}><Frame size={22} /></button>
                {isPolylineMode && activePolyline && activePolyline.points.length >= 2 && <button className="btn btn-icon" onClick={finishPolyline} style={{ background: '#10b981', color: '#fff', borderRadius: 12 }}>✓</button>}
                <button className="btn btn-icon" onClick={handleMagicDim} style={{ color: canUse('magicDim') ? '#d946ef' : '#94a3b8', position: 'relative' }}><Wand2 size={22} />{!canUse('magicDim') && <Crown size={10} color="#eab308" style={{ position: 'absolute', top: 4, right: 4 }} />}</button>
                <button className={`btn btn-icon ${isTextMode ? 'active-tool' : ''}`} onClick={() => { setIsTextMode(!isTextMode); setIsDrawingMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsEditFrameMode(false); document.body.style.cursor = !isTextMode ? 'text' : 'default'; setSelectedId(null); }} style={{ background: isTextMode ? '#dbeafe' : 'transparent', color: isTextMode ? '#2563eb' : '#475569' }}><Type size={22} /></button>
                <button className={`btn btn-icon ${isCalibMode ? 'active-tool' : ''}`} onClick={() => { const next = !isCalibMode; setIsCalibMode(next); setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); setIsVerticalMode(false); setIsEditFrameMode(false); if (next) { setCalibPoints([]); } document.body.style.cursor = next ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isCalibMode ? '#fef3c7' : (currentDoc.homography ? '#d1fae5' : 'transparent'), color: isCalibMode ? '#d97706' : (currentDoc.homography ? '#059669' : '#475569') }}><Crosshair size={22} /></button>
                {currentDoc.homography && !isCalibMode && (
                  <button className={`btn btn-icon ${isVerticalMode ? 'active-tool' : ''}`} onClick={() => { setIsVerticalMode(!isVerticalMode); setIsCalibMode(false); setIsDrawingMode(false); setIsTextMode(false); setIsPolylineMode(false); setActivePolyline(null); setPolylinePreview(null); if (!isVerticalMode) setVerticalPoints([]); document.body.style.cursor = !isVerticalMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isVerticalMode ? '#f3e8ff' : (currentDoc.verticalPoints ? '#ede9fe' : 'transparent'), color: isVerticalMode ? '#7c3aed' : (currentDoc.verticalPoints ? '#7c3aed' : '#475569'), fontSize: 11, fontWeight: 700 }}>Z</button>
                )}
                <div className="divider"></div>
                <button className="btn btn-icon" onClick={() => { if (requireFeature('share')) handleShare(currentDoc); }} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', position: 'relative' }}><Share2 size={22} color={canUse('share') ? '#2563eb' : '#94a3b8'} />{!canUse('share') && <Crown size={10} color="#eab308" style={{ position: 'absolute', top: 4, right: 4 }} />}</button>
                <button className="btn btn-icon" onClick={() => { setSelectedId(null); setIsEditFrameMode(false); setTimeout(() => executeDownload(currentDoc), 100); }}><Download size={22} color="#059669" /></button>
              </>
            )}
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
                  {doc.img ? <img src={doc.img.src} alt="thumb" /> : <div className="plan-thumb">📐</div>}
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