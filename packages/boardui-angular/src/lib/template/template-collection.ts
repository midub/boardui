import { Template } from './template';

export class TemplateCollection {
  private _templates = new Map<string, Template>();

  /** Gets template by name. */
  get(name: string) {
    return this._templates.get(name);
  }

  /** Adds template. Template must have unique name. */
  add(template: Template) {
    this._templates.set(template.name, template);
  }

  remove(name: string) {
    this._templates.delete(name);
  }
}
