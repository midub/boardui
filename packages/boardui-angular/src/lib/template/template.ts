export interface Template {
  name: string;
  render(target: any, data: any): any[];
}
