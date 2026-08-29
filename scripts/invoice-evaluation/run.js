import { readFile } from "node:fs/promises";
import { evaluateRun } from "../../src/server/modules/invoice-extraction/invoice-evaluation.metrics.js";
import { evaluateRelease } from "../../src/server/modules/invoice-extraction/invoice-evaluation.release.js";

export async function runInvoiceEvaluation({ corpusPath, predictionsPath, registryHash, gates } = {}) {
  if (!corpusPath || !predictionsPath || !registryHash) throw new Error("corpusPath, predictionsPath, and registryHash are required");
  const [corpus, predictions] = await Promise.all([readFile(corpusPath,"utf8").then(JSON.parse),readFile(predictionsPath,"utf8").then(JSON.parse)]);
  const report=evaluateRun({registryHash,corpus,predictions}); return {...report,release:evaluateRelease({...report,gates})};
}

if (import.meta.url===new URL(process.argv[1],"file:").href) {
  const [corpusPath,predictionsPath,registryHash]=process.argv.slice(2); runInvoiceEvaluation({corpusPath,predictionsPath,registryHash}).then((report)=>process.stdout.write(`${JSON.stringify(report,null,2)}\n`)).catch((error)=>{process.stderr.write(`Invoice evaluation failed: ${error.message}\n`);process.exitCode=1;});
}
