import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {xlsxBuffer} from '../src/excel/xlsx.ts';
import {createExport} from '../src/export.ts';
import {demoReport} from './helpers/runtime-report.ts';
describe('real XLSX export',()=>{
  it('round-trips all rows, full link identities, numeric values and unknowns in six styled sheets',async()=>{
    const report=demoReport(205);report.requests[0].input=null;report.tools[0].imageTokens=null;
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await xlsxBuffer(createExport(null,report)));
    expect(workbook.worksheets.map(w=>w.name)).toEqual(['概览','模型请求','工具明细','请求工具关联','World 汇总','静态排行']);
    const requests=workbook.getWorksheet('模型请求')!;expect(requests.rowCount).toBe(206);
    expect(requests.getRow(2).getCell(13).value).toBeNull();expect(requests.getRow(2).getCell(18).value).toBeNull();
    expect(requests.getRow(3).getCell(13).value).toBe(report.requests[1].input);expect(typeof requests.getRow(3).getCell(13).value).toBe('number');
    expect(requests.views[0]).toMatchObject({state:'frozen',ySplit:1});expect(requests.autoFilter).toBeTruthy();
    const links=workbook.getWorksheet('请求工具关联')!;expect(links.rowCount).toBe(207);
    expect(links.getRow(2).getCell(1).value).toBe(report.requests[0].id);expect(links.getRow(2).getCell(2).value).toBe(report.requests[0].tools[0]);
    expect(workbook.getWorksheet('静态排行')!.rowCount).toBe(1);
  });
  it('writes untrusted names as literal strings and keeps subset meters out of totals',async()=>{
    const report=demoReport(1);report.tools[0].tool='=HYPERLINK("https://example.invalid")';
    report.requests[0].input=100;report.requests[0].output=20;report.requests[0].cachedInput=70;report.requests[0].uncachedInput=30;report.requests[0].reasoning=5;
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await xlsxBuffer(createExport(null,report),'en'));
    expect(workbook.getWorksheet('Requests')!.getRow(2).getCell(18).value).toBe(120);
    const cell=workbook.getWorksheet('Tools')!.getRow(2).getCell(8);expect(cell.value).toBe(report.tools[0].tool);expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(workbook.getWorksheet('Overview')!.getRow(1).getCell(1).value).toBe('key');
  });
});
