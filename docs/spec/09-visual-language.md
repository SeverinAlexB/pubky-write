# Visual language

Applies to all application UI (not to document content).

## Colours

| Token | Value | Use |
| --- | --- | --- |
| Surface (app background) | `#f8fafd` | Header, menu bar, area around pages |
| Toolbar container | `#f1f4f8` (observed; a pale blue-grey) | The rounded toolbar bar |
| Page | `#ffffff` | Pages |
| Page border | `#c4c7c5`, 1px | Around each page |
| Primary | `#0b57d0` | Filled buttons, focused field outlines, checked boxes, links in UI |
| Primary container | `#d3e3fd` | Selected/pressed toolbar buttons, selected list rows, active tab pill |
| Text | `#1f1f1f` | UI text |
| Text secondary | `#444746` | Toolbar icons, secondary labels |
| Text tertiary | `#5f6368` | Timestamps, hints |
| Outline | `#747775` | Unfocused outlined text fields |
| Divider | `#c7c7c7` | Toolbar separators |
| Text selection in document | `#adc6f7` | Selected document text |
| Find match | `#ccedd2` | Every match |
| Find current match | `#87d392` | The current match |
| Comment anchor | `#fcf2d1` | Commented text |
| Comment anchor (active) | `#f2bf42` | Commented text of the active thread |

## Shapes and elevation

- Toolbar: one container, height 40px, fully rounded ends (radius 24px), 16px
  from the window's left and right edges.
- Toolbar buttons: 28–30px square hit areas, radius 4px, hover tint
  `rgb(68 71 70 / 8%)`.
- Menus and dropdowns: white, radius 4px, shadow
  `0 2px 6px 2px rgb(60 64 67 / 15%), 0 1px 2px rgb(60 64 67 / 30%)`, item
  height about 32px, 6px vertical padding, separators as 1px lines with 8px
  vertical margin.
- Dialogs (Find and replace, Word count, Custom spacing): white surface, radius
  28px, 24px padding, title 24px regular weight, modal scrim
  `rgb(0 0 0 / 32%)`. Buttons: text buttons in primary colour, the main action
  as a filled pill (primary background, white text, height 40px, radius 20px).
- Outlined text fields: radius 4px, 1px outline `#747775`, 2px primary outline
  when focused, with the label moving into the top border ("floating label").
- Floating cards (find bar, active comment): radius 8–12px, shadow
  `0 1px 3px rgb(0 0 0 / 30%), 0 4px 8px 3px rgb(0 0 0 / 15%)`.

## Typography

- UI font: a neutral sans-serif (for example Roboto or the system UI font).
  Menu items 14px, toolbar text 14px, document title 18px, dialog titles 24px,
  small labels 12px.
- Document content defaults to Arial 11pt (see 04).

## Icons

Use one consistent open-licensed outline icon set at 20px in the toolbar and
18px in menus. Material Symbols (Apache 2.0) is a good fit; Lucide is
acceptable.
