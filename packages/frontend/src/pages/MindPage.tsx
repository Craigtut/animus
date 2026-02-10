/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { MindSubNav, getActiveSection, type MindSection } from '../components/mind/MindSubNav';
import { EmotionsSection } from '../components/mind/EmotionsSection';
import { ThoughtsSection } from '../components/mind/ThoughtsSection';
import { MemoriesSection } from '../components/mind/MemoriesSection';
import { GoalsSection } from '../components/mind/GoalsSection';
import { AgentsSection } from '../components/mind/AgentsSection';

const sectionComponents: Record<MindSection, React.FC> = {
  emotions: EmotionsSection,
  thoughts: ThoughtsSection,
  memories: MemoriesSection,
  goals: GoalsSection,
  agents: AgentsSection,
};

export function MindPage() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const activeSection = getActiveSection(location.pathname);

  // Default to /mind/emotions if just /mind
  useEffect(() => {
    if (location.pathname === '/mind' || location.pathname === '/mind/') {
      navigate('/mind/emotions', { replace: true });
    }
  }, [location.pathname, navigate]);

  const SectionComponent = sectionComponents[activeSection];

  return (
    <div css={css`min-height: 100vh;`}>
      <div
        css={css`
          max-width: 840px;
          margin: 0 auto;
          padding: 0 ${theme.spacing[6]};

          @media (max-width: ${theme.breakpoints.md}) {
            padding: 0 ${theme.spacing[4]};
          }
        `}
      >
        {/* Sub-navigation */}
        <div css={css`
          margin-bottom: ${theme.spacing[8]};
          padding-top: ${theme.spacing[2]};
        `}>
          <MindSubNav />
        </div>

        {/* Active section content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <SectionComponent />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
