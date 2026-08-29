import { mount, unmount, type Component } from 'svelte';
import { writable, type Readable, type Writable } from 'svelte/store';
import type { PanePanelRenderer } from './engine.js';
import type { PanePanelState } from './layout.js';

export interface SveltePaneModel {
  id: string;
  params: Record<string, unknown>;
  title: string;
  visible: boolean;
}

export interface SveltePaneProps {
  model: Readable<SveltePaneModel>;
}

export type SveltePaneComponent = Component<SveltePaneProps>;

export class SveltePaneRenderer implements PanePanelRenderer {
  readonly element = document.createElement('div');
  readonly #model: Writable<SveltePaneModel>;
  readonly #instance: Record<string, unknown>;

  constructor(component: SveltePaneComponent, panel: PanePanelState) {
    this.element.className = 'pane-panel';
    this.#model = writable(model(panel, true));
    this.#instance = mount(component, {
      target: this.element,
      props: { model: this.#model },
    });
  }

  update(panel: PanePanelState, visible: boolean): void {
    this.#model.set(model(panel, visible));
  }

  dispose(): void {
    void unmount(this.#instance);
    this.element.remove();
  }
}

export function createSvelteRenderer(components: Record<string, SveltePaneComponent>) {
  return (panel: PanePanelState): SveltePaneRenderer => {
    const component = components[panel.component];
    if (!component) throw new Error(`Unknown pane component: ${panel.component}`);
    return new SveltePaneRenderer(component, panel);
  };
}

function model(panel: PanePanelState, visible: boolean): SveltePaneModel {
  return {
    id: panel.id,
    params: panel.params ?? {},
    title: panel.title,
    visible,
  };
}
