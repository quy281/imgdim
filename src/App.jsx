import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Arrow, Label, Tag, Text, Group, Circle, Line as KonvaLine, Rect as KonvaRect, Transformer } from 'react-konva';
import { ImagePlus, Download, PencilRuler, Grid3X3, Frame, Stamp, SaveAll, Unlock, Lock, Camera, Images, X } from 'lucide-react';
import './App.css';

const DimensionLine = ({ line, onTextEdit, onChange, onSelect, isSelected, stageScale }) => {
  const invScale = 1 / stageScale;

  const handleDrag = (point, e, commit = false) => {
    let x = e.target.x(); let y = e.target.y();
    if (e.evt && e.evt.shiftKey) {
      const fixedPoint = point === 'start' ? line.end : line.start;
      const dx = x - fixedPoint.x; const dy = y - fixedPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const currentAngle = Math.atan2(dy, dx);
      const snapAngle = Math.round(currentAngle / (Math.PI / 4)) * (Math.PI / 4);
      x = fixedPoint.x + Math.cos(snapAngle) * distance;
      y = fixedPoint.y + Math.sin(snapAngle) * distance;
      e.target.x(x); e.target.y(y);
    }
    const updatedLine = { ...line };
    if (point === 'start') updatedLine.start = { x, y }; else updatedLine.end = { x, y };
    onChange(updatedLine, commit);
  };

  const color = isSelected ? "#3b82f6" : "white";

  return (
    <Group
      name="dim-group" draggable
      onClick={(e) => { e.cancelBubble = true; onSelect(line.id); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(line.id); }} // Thêm onTap cho mobile
      onDragStart={(e) => { if (e.target.name() === 'handle') e.cancelBubble = true; }}
      onDragEnd={(e) => {
        if (e.target.name() === 'dim-group') {
          const dx = e.target.x(); const dy = e.target.y();
          const newLine = { ...line, start: { x: line.start.x + dx, y: line.start.y + dy }, end: { x: line.end.x + dx, y: line.end.y + dy } };
          onChange(newLine, true); // Lưu vào History khi thả chuột xong
          e.target.x(0); e.target.y(0);
        }
      }}
      onMouseEnter={(e) => { if (e.target.name() === 'dim-group') e.target.getStage().container().style.cursor = 'move'; }}
      onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
    >
      <Arrow points={[line.start.x, line.start.y, line.end.x, line.end.y]} stroke={color} strokeWidth={1 * invScale} fill={color} pointerLength={6 * invScale} pointerWidth={6 * invScale} hitStrokeWidth={20 * invScale} shadowColor="black" shadowBlur={2} shadowOpacity={0.3} />
      <Arrow points={[line.end.x, line.end.y, line.start.x, line.start.y]} stroke={color} strokeWidth={1 * invScale} fill={color} pointerLength={6 * invScale} pointerWidth={6 * invScale} hitStrokeWidth={20 * invScale} shadowColor="black" shadowBlur={2} shadowOpacity={0.3} />

      <Label
        x={(line.start.x + line.end.x) / 2} y={(line.start.y + line.end.y) / 2}
        offsetX={((line.label.length * 6 + 16) / 2) * invScale} offsetY={12 * invScale}
        onDblClick={(e) => { e.cancelBubble = true; onTextEdit(line); }}
        onDblTap={(e) => { e.cancelBubble = true; onTextEdit(line); }} // Thêm onDblTap cho mobile
        onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
      >
        <Tag fill="rgba(0,0,0,0.65)" cornerRadius={12 * invScale} />
        <Text text={line.label} fill="white" fontSize={11 * invScale} padding={6 * invScale} fontFamily="Inter" fontStyle="500" />
      </Label>

      {isSelected && (
        <>
          <Circle name="handle" x={line.start.x} y={line.start.y} radius={6 * invScale} hitStrokeWidth={20 * invScale} fill="#3b82f6" draggable onDragStart={(e) => e.cancelBubble = true} onDragMove={(e) => handleDrag('start', e, false)} onDragEnd={(e) => { e.cancelBubble = true; handleDrag('start', e, true); }} onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'crosshair'; }} onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; }} />
          <Circle name="handle" x={line.end.x} y={line.end.y} radius={6 * invScale} hitStrokeWidth={20 * invScale} fill="#3b82f6" draggable onDragStart={(e) => e.cancelBubble = true} onDragMove={(e) => handleDrag('end', e, false)} onDragEnd={(e) => { e.cancelBubble = true; handleDrag('end', e, true); }} onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'crosshair'; }} onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; }} />
        </>
      )}
    </Group>
  );
};

const FrameOverlay = ({ frameImg, frameAttrs, onChange, isEditing }) => {
  const shapeRef = useRef();
  const trRef = useRef();

  useEffect(() => {
    if (isEditing && trRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isEditing]);

  return (
    <>
      <KonvaImage
        image={frameImg} ref={shapeRef}
        x={frameAttrs.x} y={frameAttrs.y} width={frameAttrs.width} height={frameAttrs.height}
        draggable={isEditing} listening={isEditing}
        onDragEnd={(e) => onChange({ ...frameAttrs, x: e.target.x(), y: e.target.y() })}
        onTransformEnd={() => {
          const node = shapeRef.current;
          const scaleX = node.scaleX(); const scaleY = node.scaleY();
          node.scaleX(1); node.scaleY(1);
          onChange({ x: node.x(), y: node.y(), width: Math.max(50, node.width() * scaleX), height: Math.max(50, node.height() * scaleY) });
        }}
      />
      {isEditing && <Transformer ref={trRef} boundBoxFunc={(oldBox, newBox) => newBox} rotateEnabled={false} />}
    </>
  );
};

export default function App() {
  const [docs, setDocs] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [copiedLine, setCopiedLine] = useState(null);

  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isGridMode, setIsGridMode] = useState(false);
  const [tempLine, setTempLine] = useState(null);
  const [isExportingAll, setIsExportingAll] = useState(false);

  const [showFrame, setShowFrame] = useState(false);
  const [isEditFrameMode, setIsEditFrameMode] = useState(false);
  const [customFrame, setCustomFrame] = useState(null);
  const [watermarkTxt, setWatermarkTxt] = useState('');
  const [customWatermark, setCustomWatermark] = useState(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showMobileHistory, setShowMobileHistory] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const mainAreaRef = useRef();
  const stageRef = useRef();
  const currentDoc = docs.find(d => d.id === activeDocId);

  // Cập nhật State thông thường (không lưu Undo)
  const updateDoc = (updates) => {
    setDocs(prev => prev.map(d => d.id === activeDocId ? { ...d, ...updates } : d));
  };

  // Cập nhật State và LƯU LỊCH SỬ (Dùng cho vẽ, xóa, ctrl+v, drag xong)
  const commitHistory = (newLines) => {
    setDocs(prev => prev.map(d => {
      if (d.id === activeDocId) {
        const history = d.linesHistory.slice(0, d.historyStep + 1);
        history.push(newLines);
        return { ...d, lines: newLines, linesHistory: history, historyStep: history.length - 1 };
      }
      return d;
    }));
  };

  useEffect(() => {
    const updateSize = () => { if (mainAreaRef.current) setStageSize({ width: mainAreaRef.current.offsetWidth, height: mainAreaRef.current.offsetHeight }); };
    window.addEventListener('resize', updateSize);
    updateSize(); return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Xử lý Phím Tắt: Undo/Redo/Copy/Paste
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!currentDoc) return;

      // ESC: Thoát lệnh
      if (e.key === 'Escape') { setIsDrawingMode(false); setSelectedId(null); setIsEditFrameMode(false); document.body.style.cursor = 'default'; }

      // Delete: Xóa
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null && !isEditFrameMode) {
        commitHistory(currentDoc.lines.filter(l => l.id !== selectedId));
        setSelectedId(null);
      }

      // Ctrl + Z: Undo
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        if (currentDoc.historyStep > 0) {
          const prevStep = currentDoc.historyStep - 1;
          updateDoc({ lines: currentDoc.linesHistory[prevStep], historyStep: prevStep });
          setSelectedId(null);
        }
      }

      // Ctrl + Y: Redo
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        if (currentDoc.historyStep < currentDoc.linesHistory.length - 1) {
          const nextStep = currentDoc.historyStep + 1;
          updateDoc({ lines: currentDoc.linesHistory[nextStep], historyStep: nextStep });
          setSelectedId(null);
        }
      }

      // Ctrl + C: Copy
      if (e.ctrlKey && e.key.toLowerCase() === 'c' && selectedId !== null) {
        const line = currentDoc.lines.find(l => l.id === selectedId);
        if (line) setCopiedLine(line);
      }

      // Ctrl + V: Paste
      if (e.ctrlKey && e.key.toLowerCase() === 'v' && copiedLine) {
        const newLine = {
          ...copiedLine, id: Date.now(),
          start: { x: copiedLine.start.x + 40 / currentDoc.stageScale, y: copiedLine.start.y + 40 / currentDoc.stageScale },
          end: { x: copiedLine.end.x + 40 / currentDoc.stageScale, y: copiedLine.end.y + 40 / currentDoc.stageScale }
        };
        commitHistory([...currentDoc.lines, newLine]);
        setSelectedId(newLine.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDoc, selectedId, isEditFrameMode, copiedLine]);

  const initFrameAttrs = (baseImg, overlayImg) => {
    const scale = Math.min(baseImg.width / overlayImg.width, baseImg.height / overlayImg.height);
    const fw = overlayImg.width * scale; const fh = overlayImg.height * scale;
    return { x: (baseImg.width - fw) / 2, y: (baseImg.height - fh) / 2, width: fw, height: fh };
  };

  const handleUpload = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new window.Image(); image.src = reader.result;
        image.onload = () => {
          const w = mainAreaRef.current ? mainAreaRef.current.offsetWidth : window.innerWidth;
          const h = mainAreaRef.current ? mainAreaRef.current.offsetHeight : window.innerHeight - 150;
          const pad = isMobile ? 10 : 100;
          const autoScale = isMobile
            ? Math.min(w / image.width, h / image.height)
            : Math.min((w - pad) / image.width, (h - pad) / image.height, 1);
          const cx = image.width / 2; const cy = image.height / 2;

          const newDoc = {
            id: Date.now() + Math.random(), name: file.name, img: image,
            lines: [], linesHistory: [[]], historyStep: 0, // Cấu trúc History
            globalRatio: null,
            gridPoints: [{ x: cx - 200, y: cy + 100 }, { x: cx + 200, y: cy + 100 }, { x: cx + 100, y: cy - 50 }, { x: cx - 100, y: cy - 50 }],
            frameAttrs: customFrame ? initFrameAttrs(image, customFrame) : null,
            stageScale: autoScale,
            stagePos: { x: (w - image.width * autoScale) / 2, y: (h - image.height * autoScale) / 2 + 20 }
          };
          setDocs(prev => [...prev, newDoc]);
          setActiveDocId(newDoc.id);
        };
      };
      reader.readAsDataURL(file);
    });
    if (showMobileHistory) setShowMobileHistory(false);
  };

  const handleUploadCustomFrame = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new window.Image(); image.src = reader.result;
      image.onload = () => {
        setCustomFrame(image); setShowFrame(true);
        setDocs(prev => prev.map(d => ({ ...d, frameAttrs: initFrameAttrs(d.img, image) })));
      };
    };
    reader.readAsDataURL(file);
  };

  const handleUploadCustomWatermark = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new window.Image(); image.src = reader.result;
      image.onload = () => setCustomWatermark(image);
    };
    reader.readAsDataURL(file);
  };

  const handleTextEdit = (line) => {
    const userInput = prompt("Nhập kích thước thực tế (VD: 800, 5000):", line.label);
    if (userInput !== null) {
      const val = parseFloat(userInput);
      const dx = line.end.x - line.start.x; const dy = line.end.y - line.start.y;
      const pxDist = Math.sqrt(dx * dx + dy * dy);

      const newLines = currentDoc.lines.map(l => l.id === line.id ? { ...l, label: userInput } : l);

      if (!isNaN(val) && pxDist > 0) {
        updateDoc({ globalRatio: val / pxDist }); // Cập nhật Ratio
      }
      commitHistory(newLines); // Lưu vào History
    }
  };

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
    const stage = stageRef.current;
    if (!stage) return null;
    // For touch events, manually set pointer position from touch coordinates
    if (e.evt && e.evt.touches && e.evt.touches.length > 0) {
      const touch = e.evt.touches[0];
      const rect = stage.container().getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    if (e.evt && e.evt.changedTouches && e.evt.changedTouches.length > 0) {
      const touch = e.evt.changedTouches[0];
      const rect = stage.container().getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return stage.getPointerPosition();
  };

  const handleStageMouseDown = (e) => {
    if (isEditFrameMode) return;
    if (e.target.name() === 'handle' || e.target.name() === 'grid-handle') return;
    if (!isDrawingMode) { if (e.target === e.target.getStage() || e.target.className === 'Image') setSelectedId(null); return; }

    // Prevent default touch behavior (scrolling) when drawing
    if (e.evt && e.evt.cancelable) e.evt.preventDefault();

    const stage = stageRef.current; const pos = getPointerPos(e);
    if (!pos) return;
    const x = (pos.x - stage.x()) / stage.scaleX();
    const y = (pos.y - stage.y()) / stage.scaleY();
    setTempLine({ start: { x, y }, end: { x, y } });
  };

  const handleStageMouseMove = (e) => {
    if (!isDrawingMode || !tempLine || isEditFrameMode) return;
    if (e.evt && e.evt.cancelable) e.evt.preventDefault();
    const stage = stageRef.current; const pos = getPointerPos(e);
    if (!pos) return;
    let x = (pos.x - stage.x()) / stage.scaleX();
    let y = (pos.y - stage.y()) / stage.scaleY();

    if (e.evt && e.evt.shiftKey) {
      const dx = x - tempLine.start.x; const dy = y - tempLine.start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const currentAngle = Math.atan2(dy, dx);
      const snapAngle = Math.round(currentAngle / (Math.PI / 4)) * (Math.PI / 4);
      x = tempLine.start.x + Math.cos(snapAngle) * distance;
      y = tempLine.start.y + Math.sin(snapAngle) * distance;
    }
    setTempLine({ ...tempLine, end: { x, y } });
  };

  const handleStageMouseUp = () => {
    if (!isDrawingMode || !tempLine || isEditFrameMode) return;
    const dx = tempLine.end.x - tempLine.start.x; const dy = tempLine.end.y - tempLine.start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 10) {
      let labelVal = Math.round(distance).toString();
      if (currentDoc.globalRatio) {
        let realVal = distance * currentDoc.globalRatio;
        realVal = Math.round(realVal / 10) * 10;
        labelVal = realVal.toString();
      }
      const newLine = { id: Date.now(), start: tempLine.start, end: tempLine.end, label: labelVal };
      commitHistory([...currentDoc.lines, newLine]); // LƯU VÀO HISTORY KHI VẼ XONG
      setSelectedId(newLine.id);
    }
    setTempLine(null);
  };

  const updateGridPoint = (index, x, y) => {
    const newPoints = [...currentDoc.gridPoints];
    newPoints[index] = { x, y }; updateDoc({ gridPoints: newPoints });
  };

  const executeDownload = (doc) => {
    let cropBox = { x: 0, y: 0, width: doc.img.width, height: doc.img.height };
    if (showFrame && customFrame && doc.frameAttrs) {
      cropBox = { x: doc.frameAttrs.x, y: doc.frameAttrs.y, width: doc.frameAttrs.width, height: doc.frameAttrs.height };
    }
    const uri = stageRef.current.getChildren()[0].toDataURL({ pixelRatio: 2, ...cropBox });
    const link = document.createElement('a'); link.download = `[DIM]_${doc.name}`; link.href = uri; link.click();
  };

  const handleBatchExport = async () => {
    if (docs.length === 0) return;
    setIsExportingAll(true); setSelectedId(null); setIsGridMode(false); setIsEditFrameMode(false);
    for (let i = 0; i < docs.length; i++) {
      setActiveDocId(docs[i].id);
      await new Promise(resolve => setTimeout(resolve, 500));
      executeDownload(docs[i]);
    }
    setIsExportingAll(false);
  };

  return (
    <div className={`app-wrapper ${isMobile ? 'mobile-layout' : 'desktop-layout'}`}>
      {!isMobile && (
        <div className="sidebar">
          <div className="p-4 font-bold border-b" style={{ padding: '15px', borderBottom: '1px solid #ddd' }}>Lịch sử phiên ({docs.length})</div>
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
              <button className="btn btn-primary w-full" style={{ justifyContent: 'center', width: '100%' }}><ImagePlus size={18} /> Thêm ảnh bản vẽ</button>
              <input type="file" multiple onChange={handleUpload} accept="image/*" />
            </div>
            <button className="btn" onClick={handleBatchExport} disabled={docs.length === 0 || isExportingAll} style={{ justifyContent: 'center', width: '100%', color: '#059669', background: '#ecfdf5', border: '1px solid #34d399' }}>
              <SaveAll size={18} /> {isExportingAll ? 'Đang xuất...' : 'Xuất Toàn Bộ'}
            </button>
          </div>

          <div style={{ padding: '15px', borderTop: '1px solid #ddd', background: '#f8fafc' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#475569' }}>Cài đặt Mặc định</div>
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
            <button className="btn" onClick={() => { setIsDrawingMode(!isDrawingMode); setIsEditFrameMode(false); document.body.style.cursor = !isDrawingMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isDrawingMode ? '#fef08a' : 'transparent', color: isDrawingMode ? '#ca8a04' : '#475569' }} disabled={!currentDoc}>
              <PencilRuler size={18} /> {isDrawingMode ? 'Đang vẽ Dim...' : 'Vẽ Dim'}
            </button>
            <button className="btn" onClick={() => { setIsGridMode(!isGridMode); }} style={{ background: isGridMode ? '#e0e7ff' : 'transparent', color: isGridMode ? '#4f46e5' : '#475569' }} disabled={!currentDoc}>
              <Grid3X3 size={18} /> Lưới 3D
            </button>

            <div className="divider"></div>

            <button className="btn" onClick={() => { setShowFrame(!showFrame); setIsEditFrameMode(false); }} style={{ background: showFrame ? '#fee2e2' : 'transparent', color: showFrame ? '#b91c1c' : '#475569' }} disabled={!currentDoc}>
              <Frame size={18} /> {showFrame ? 'Tắt Khung' : 'Bật Khung'}
            </button>

            {showFrame && customFrame && (
              <button className="btn" onClick={() => { setIsEditFrameMode(!isEditFrameMode); setIsDrawingMode(false); document.body.style.cursor = 'default'; }} style={{ background: isEditFrameMode ? '#dbeafe' : 'transparent', color: isEditFrameMode ? '#1d4ed8' : '#475569', border: isEditFrameMode ? '1px solid #93c5fd' : 'none' }}>
                {isEditFrameMode ? <Lock size={18} /> : <Unlock size={18} />} Khóa/Mở Khung
              </button>
            )}

            <div className="divider"></div>
            <button className="btn" onClick={() => { setSelectedId(null); setIsGridMode(false); setIsEditFrameMode(false); setTimeout(() => executeDownload(currentDoc), 100); }} disabled={!currentDoc}>
              <Download size={18} /> Lưu ảnh này
            </button>
          </div>
        )}

        {!currentDoc ? (
          <div className="empty-state">
            <div className="upload-box">
              <Camera size={64} style={{ marginBottom: 10, color: '#3b82f6' }} />
              <h2 style={{ fontSize: '18px', margin: '5px 0' }}>Chụp ảnh hoặc Tải ảnh lên</h2>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px', width: '100%', padding: '0 20px', boxSizing: 'border-box' }}>
                <div className="file-input-wrapper" style={{ flex: 1 }}>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}><Camera size={18} /> {isMobile ? '' : 'Chụp'}</button>
                  <input type="file" onChange={handleUpload} accept="image/*" capture="environment" />
                </div>
                <div className="file-input-wrapper" style={{ flex: 1 }}>
                  <button className="btn" style={{ width: '100%', justifyContent: 'center', border: '1px solid #cbd5e1' }}><ImagePlus size={18} /> {isMobile ? '' : 'Thư viện'}</button>
                  <input type="file" multiple onChange={handleUpload} accept="image/*" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {!isMobile && (
              <div className="hint-text">
                {isDrawingMode ? 'Kéo chuột để vẽ (Giữ SHIFT để khóa trục ngang/dọc)' : 'Bấm Ctrl+Z (Undo) | Ctrl+Y (Redo) | Ctrl+C (Copy) | Ctrl+V (Paste) | Delete (Xóa)'}
              </div>
            )}

            <Stage
              width={stageSize.width} height={stageSize.height} ref={stageRef} scaleX={currentDoc.stageScale} scaleY={currentDoc.stageScale} x={currentDoc.stagePos.x} y={currentDoc.stagePos.y}
              draggable={!isDrawingMode && !isEditFrameMode}
              onWheel={handleWheel}
              onMouseDown={handleStageMouseDown} onMouseMove={handleStageMouseMove} onMouseUp={handleStageMouseUp}
              onTouchStart={handleStageMouseDown} onTouchMove={handleStageMouseMove} onTouchEnd={handleStageMouseUp}
              onDragEnd={(e) => {
                if (e.target === stageRef.current) updateDoc({ stagePos: { x: e.target.x(), y: e.target.y() } });
              }}
            >
              <Layer>
                <KonvaImage image={currentDoc.img} x={0} y={0} />

                {isGridMode && (
                  <Group>
                    <KonvaLine points={[currentDoc.gridPoints[0].x, currentDoc.gridPoints[0].y, currentDoc.gridPoints[1].x, currentDoc.gridPoints[1].y, currentDoc.gridPoints[2].x, currentDoc.gridPoints[2].y, currentDoc.gridPoints[3].x, currentDoc.gridPoints[3].y]} closed stroke="#4f46e5" strokeWidth={2 / currentDoc.stageScale} dash={[5 / currentDoc.stageScale, 5 / currentDoc.stageScale]} fill="rgba(79, 70, 229, 0.1)" />
                    <KonvaLine points={[currentDoc.gridPoints[0].x, currentDoc.gridPoints[0].y, currentDoc.gridPoints[2].x, currentDoc.gridPoints[2].y]} stroke="#4f46e5" strokeWidth={1 / currentDoc.stageScale} dash={[5 / currentDoc.stageScale, 5 / currentDoc.stageScale]} />
                    <KonvaLine points={[currentDoc.gridPoints[1].x, currentDoc.gridPoints[1].y, currentDoc.gridPoints[3].x, currentDoc.gridPoints[3].y]} stroke="#4f46e5" strokeWidth={1 / currentDoc.stageScale} dash={[5 / currentDoc.stageScale, 5 / currentDoc.stageScale]} />
                    {currentDoc.gridPoints.map((pt, i) => (
                      <Circle key={i} name="grid-handle" x={pt.x} y={pt.y} radius={8 / currentDoc.stageScale} fill="white" stroke="#4f46e5" strokeWidth={3 / currentDoc.stageScale} draggable onDragMove={(e) => updateGridPoint(i, e.target.x(), e.target.y())} onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'move'; }} onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'crosshair'; }} />
                    ))}
                  </Group>
                )}

                {currentDoc.lines.map((line) => (
                  <DimensionLine key={line.id} line={line} stageScale={currentDoc.stageScale} isSelected={line.id === selectedId} onSelect={setSelectedId} onTextEdit={handleTextEdit}
                    onChange={(newVal, commit = false) => {
                      const newLines = currentDoc.lines.map(l => l.id === newVal.id ? newVal : l);
                      if (commit) commitHistory(newLines); else updateDoc({ lines: newLines });
                    }}
                  />
                ))}

                {tempLine && <KonvaLine points={[tempLine.start.x, tempLine.start.y, tempLine.end.x, tempLine.end.y]} stroke="#eab308" strokeWidth={2 / currentDoc.stageScale} dash={[5 / currentDoc.stageScale, 5 / currentDoc.stageScale]} />}

                {customWatermark ? (
                  <KonvaImage image={customWatermark} x={currentDoc.img.width / 2} y={currentDoc.img.height / 2} offsetX={customWatermark.width / 2} offsetY={customWatermark.height / 2} scaleX={(currentDoc.img.width * 0.4) / customWatermark.width} scaleY={(currentDoc.img.width * 0.4) / customWatermark.width} opacity={0.3} listening={false} />
                ) : watermarkTxt ? (
                  <Group x={currentDoc.img.width / 2} y={currentDoc.img.height / 2} rotation={-25} listening={false}>
                    <Text x={-currentDoc.img.width} y={-currentDoc.img.width * 0.05} width={currentDoc.img.width * 2} text={watermarkTxt} fontSize={Math.max(currentDoc.img.width / 12, 50)} fill="rgba(255, 255, 255, 0.35)" stroke="rgba(0, 0, 0, 0.15)" strokeWidth={3} align="center" fontStyle="bold" fontFamily="Inter" />
                  </Group>
                ) : null}

                {showFrame && (
                  customFrame && currentDoc.frameAttrs ? (
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
                  )
                )}
              </Layer>
            </Stage>
          </>
        )}
      </div>

      {isMobile && currentDoc && (
        <div className="bottom-bar">
          <div className="bottom-tools">
            <button className="btn btn-icon" onClick={() => setShowMobileHistory(true)} style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <Images size={22} />
            </button>
            <div className="divider"></div>

            <div className="file-input-wrapper">
              <button className="btn btn-icon btn-primary"><Camera size={22} /></button>
              <input type="file" onChange={handleUpload} accept="image/*" capture="environment" />
            </div>

            <div className="file-input-wrapper">
              <button className="btn btn-icon" style={{ border: '1px dashed #cbd5e1' }}><ImagePlus size={22} /></button>
              <input type="file" multiple onChange={handleUpload} accept="image/*" />
            </div>

            <div className="divider"></div>

            <button className={`btn btn-icon ${isDrawingMode ? 'active-tool' : ''}`} onClick={() => { setIsDrawingMode(!isDrawingMode); setIsEditFrameMode(false); document.body.style.cursor = !isDrawingMode ? 'crosshair' : 'default'; setSelectedId(null); }} style={{ background: isDrawingMode ? '#fef08a' : 'transparent', color: isDrawingMode ? '#ca8a04' : '#475569' }}>
              <PencilRuler size={22} />
            </button>
            <button className={`btn btn-icon ${isGridMode ? 'active-tool' : ''}`} onClick={() => { setIsGridMode(!isGridMode); }} style={{ background: isGridMode ? '#e0e7ff' : 'transparent', color: isGridMode ? '#4f46e5' : '#475569' }}>
              <Grid3X3 size={22} />
            </button>

            <div className="divider"></div>

            <div className="file-input-wrapper">
              <button className="btn btn-icon" style={{ border: '1px dashed #cbd5e1' }} title="Khung"><Frame size={22} /></button>
              <input type="file" accept="image/png" onChange={handleUploadCustomFrame} />
            </div>

            <div className="file-input-wrapper">
              <button className="btn btn-icon" style={{ border: '1px dashed #cbd5e1' }} title="Watermark"><Stamp size={22} /></button>
              <input type="file" accept="image/png" onChange={handleUploadCustomWatermark} />
            </div>

            <div className="divider"></div>

            <button className="btn btn-icon" onClick={() => { setSelectedId(null); setIsGridMode(false); setIsEditFrameMode(false); setTimeout(() => executeDownload(currentDoc), 100); }}>
              <Download size={22} color="#059669" />
            </button>
          </div>
        </div>
      )}

      {/* Popup Quản lý Lịch sử (Mobile) */}
      {isMobile && showMobileHistory && (
        <div className="mobile-history-overlay" onClick={() => setShowMobileHistory(false)}>
          <div className="mobile-history-modal" onClick={e => e.stopPropagation()}>
            <div className="mobile-history-header">
              <h3 style={{ margin: 0, fontSize: '16px', color: '#1e293b' }}>Lịch sử ảnh ({docs.length})</h3>
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
    </div>
  );
}