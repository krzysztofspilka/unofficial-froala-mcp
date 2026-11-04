// The toolbar order of the Froala website, read from content/toolbar-order.json.
// Every preset goes through these functions, so undo and redo always come first.
import toolbarOrder from '../content/toolbar-order.json' with { type: 'json' };

const { order, phone } = toolbarOrder;
const known = new Set(order.flat());

/** Buttons in the website's order, in the website's groups. Buttons the order does not know go last. */
export function toolbarRows(buttons: string[]): string[][] {
  const rows = order.map((group) => group.filter((button) => buttons.includes(button))).filter((group) => group.length > 0);
  const others = buttons.filter((button) => !known.has(button));
  return others.length ? [...rows, others] : rows;
}

type MoreGroups = Record<string, { buttons: string[]; buttonsVisible: number }>;

/** The toolbar on phones, which is the buttons a preset names, or Froala's More groups for a long toolbar. */
export function phoneToolbar(buttons: string[], phoneButtons?: string[]): string[][] | MoreGroups {
  if (phoneButtons) return { moreText: { buttons: phoneButtons, buttonsVisible: phoneButtons.length } };
  if (buttons.length <= 10) return toolbarRows(buttons);
  const groups: MoreGroups = {};
  order.forEach((group, index) => {
    for (const button of group.filter((name) => buttons.includes(name))) {
      const name = phone[index];
      groups[name] ??= { buttons: [], buttonsVisible: 0 };
      groups[name].buttons.push(button);
    }
  });
  const others = buttons.filter((button) => !known.has(button));
  if (others.length) {
    groups.moreMisc ??= { buttons: [], buttonsVisible: 0 };
    groups.moreMisc.buttons.push(...others);
  }
  if (groups.history) groups.history.buttonsVisible = groups.history.buttons.length;
  return groups;
}
