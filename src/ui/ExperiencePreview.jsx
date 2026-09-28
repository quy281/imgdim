import React, { useEffect, useState } from 'react';
import { BookOpen, PlayCircle } from 'lucide-react';
import { latestExperience, latestExperienceFrom, loadExperienceItems } from '../lib/experienceLibrary';

export default function ExperiencePreview({ onOpenExperience, compact = false }) {
    const [items, setItems] = useState(() => latestExperience(3));

    useEffect(() => {
        let alive = true;
        loadExperienceItems().then(next => {
            if (alive) setItems(latestExperienceFrom(next, 3));
        });
        return () => { alive = false; };
    }, []);

    return (
        <section className={`experience-preview ${compact ? 'compact' : ''}`} aria-label="Kinh nghiệm mới nhất">
            <div className="section-head">
                <div>
                    <div className="section-eyebrow">Kinh nghiệm</div>
                    <div className="section-heading">3 bài mới nhất</div>
                </div>
                <button className="section-action" onClick={onOpenExperience}>
                    <BookOpen size={15} /> Tất cả
                </button>
            </div>
            <div className="experience-latest-strip">
                {items.map(item => (
                    <button key={item.id} className="experience-latest-card" onClick={onOpenExperience}>
                        <div className={`experience-thumb tone-${item.thumbTone || 'blue'}`}>
                            <PlayCircle size={22} />
                            <span>{item.category}</span>
                        </div>
                        <div className="experience-latest-title">{item.title}</div>
                    </button>
                ))}
            </div>
        </section>
    );
}
