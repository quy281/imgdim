import React from 'react';
import { Shape } from 'react-konva';

/**
 * White "paper" + mm grid, drawn in world coordinates.
 * Covers union(viewport, content bbox + 2000mm) so exports (which reset the stage
 * transform without re-rendering React) always have grid under the crop box.
 */
const PlanGrid = ({ stageScale, stagePos, stageSize, contentBounds, gridMinor = 100, gridMajor = 1000 }) => {
    let x1 = -stagePos.x / stageScale;
    let y1 = -stagePos.y / stageScale;
    let x2 = (stageSize.width - stagePos.x) / stageScale;
    let y2 = (stageSize.height - stagePos.y) / stageScale;
    if (contentBounds) {
        const M = 2000;
        x1 = Math.min(x1, contentBounds.x - M);
        y1 = Math.min(y1, contentBounds.y - M);
        x2 = Math.max(x2, contentBounds.x + contentBounds.width + M);
        y2 = Math.max(y2, contentBounds.y + contentBounds.height + M);
    }
    const showMinor = stageScale * gridMinor >= 6;

    return (
        <Shape
            name="plan-grid"
            sceneFunc={(ctx) => {
                ctx.beginPath();
                ctx.rect(x1, y1, x2 - x1, y2 - y1);
                ctx.closePath();
                ctx.fillStyle = '#ffffff';
                ctx.fill();

                const drawLines = (step, color, width) => {
                    ctx.beginPath();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = width / stageScale;
                    for (let x = Math.floor(x1 / step) * step; x <= x2; x += step) {
                        ctx.moveTo(x, y1); ctx.lineTo(x, y2);
                    }
                    for (let y = Math.floor(y1 / step) * step; y <= y2; y += step) {
                        ctx.moveTo(x1, y); ctx.lineTo(x2, y);
                    }
                    ctx.stroke();
                };
                if (showMinor) drawLines(gridMinor, '#eef2f7', 1);
                drawLines(gridMajor, '#dbe3ec', 1);
            }}
            hitFunc={(ctx, shape) => {
                ctx.beginPath();
                ctx.rect(x1, y1, x2 - x1, y2 - y1);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            }}
        />
    );
};

export default PlanGrid;
