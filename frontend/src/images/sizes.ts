// `sizes` strings for `<ResponsiveImage>` call sites. Each is an exact
// ceiling of the CSS box the image renders into, so it can never
// under-estimate and serve a too-small variant.

// .intro-heading-badge is a fixed 60x60 box (intro.css).
export const INTRO_HEADING_BADGE_SIZES = '60px';

// .leader-bar-badge is 74% of .leader-bar-btn, square with object-fit:
// contain inside a box always wider than tall, so height binds:
// 0.74 * clamp(26px, 0.78 * slot, 45px) maxes at 33.3px (leaderBar.css).
export const LEADER_BAR_BADGE_SIZES = '34px';
