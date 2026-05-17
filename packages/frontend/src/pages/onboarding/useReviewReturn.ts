/**
 * useReviewReturn
 *
 * Lets a persona step behave differently when the user arrived via an "Edit"
 * button on the review screen. Instead of walking forward through the rest of
 * the flow, the step saves and jumps straight back to review.
 *
 * Steps wrap their normal forward navigation in `finishStep(...)`. When in
 * edit mode, the wrapped callback is skipped and the user returns to review;
 * otherwise the normal next-step navigation runs unchanged.
 */

import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../../store';

const REVIEW_PATH = '/onboarding/persona/review';

export function useReviewReturn() {
  const navigate = useNavigate();
  const isEditing = useOnboardingStore((s) => s.editReturn);
  const setEditReturn = useOnboardingStore((s) => s.setEditReturn);

  /** Run `advance` for the normal flow, or return to review when editing. */
  const finishStep = (advance: () => void) => {
    if (isEditing) {
      setEditReturn(false);
      navigate(REVIEW_PATH);
    } else {
      advance();
    }
  };

  /** Discard the in-progress edits and go back to review. */
  const cancelEdit = () => {
    setEditReturn(false);
    navigate(REVIEW_PATH);
  };

  return { isEditing, finishStep, cancelEdit };
}
