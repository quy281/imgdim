import React, { useRef, useEffect } from 'react';
import { Image as KonvaImage, Transformer } from 'react-konva';

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
            <KonvaImage image={frameImg} ref={shapeRef}
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
export default FrameOverlay;
