# InstaScanner design finish — 2026-11-02

The six references were reviewed as design resources. They are not six services embedded into the application.

| Reference | Applied in InstaScanner |
| --- | --- |
| https://lucide.dev/license | Existing `lucide-react` icons reused for navigation, actions and the new empty-state component; no emoji buttons added. ISC package license retained. |
| https://realtimecolors.com | Palette-preview approach: slate surfaces, cyan #58c4e8 actions and #a0aec0 secondary text, reviewed on actual dashboard and mobile layouts. No palette generator API is called. |
| https://fontjoy.com | Pairing principle: display headings separated from UI/body typography. Local Aptos Display / Segoe UI fallbacks complement the existing Inter stack; no external font requests and no claim that Fontjoy generated the pairing. |
| https://haikei.app | Restrained geometric background treatment. Original inline SVG shapes and a subtle masthead background; no downloaded Haikei export. |
| https://undraw.co/license | Illustrated empty states with short guidance. Artwork is original, not a downloaded unDraw illustration. |
| https://lottiefiles.com/page/license | Small state transitions implemented with CSS, existing loading icons and toast feedback. No Lottie player or third-party animation file shipped. Reduced-motion preferences stop decorative animation. |

Global changes are limited to shared color tokens, heading typography and keyboard focus styling. New illustrations and masthead treatment are scoped to SmartLink Studio. No subscription or external asset tracking is introduced.

Screenshots use synthetic UI fixtures; production analytics never receives those fixture figures.
