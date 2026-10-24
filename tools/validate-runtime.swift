// Optional macOS-only runtime validation of independently generated fixtures.
// This tool is not used by either portable compiler.
import Foundation
import CoreML

if CommandLine.arguments.count != 2 { fatalError("usage: swift validate-runtime.swift REPORT.json") }
let reportURL=URL(fileURLWithPath: CommandLine.arguments[1])
let report=try JSONSerialization.jsonObject(with:Data(contentsOf:reportURL)) as! [String:Any]
let cases=report["cases"] as! [[String:Any]]
var passed=0,failures=0
for item in cases {
    guard item["synthetic"] as? Bool == true, item["encrypted"] as? Bool != true, item["error"] == nil else { continue }
    do {
        let config=MLModelConfiguration();config.computeUnits = .cpuOnly
        let reference=try MLModel(contentsOf: URL(fileURLWithPath:item["reference"] as! String),configuration:config)
        let actual=try MLModel(contentsOf: URL(fileURLWithPath:item["output"] as! String),configuration:config)
        var inputs=[String:Any]()
        for (name,description) in reference.modelDescription.inputDescriptionsByName {
            guard let constraint=description.multiArrayConstraint else { fatalError("fixture input must be multiarray") }
            let array=try MLMultiArray(shape:constraint.shape,dataType:constraint.dataType)
            for i in 0..<array.count {array[i]=NSNumber(value:Float(1+i%5)/8)}
            inputs[name]=array
        }
        let provider=try MLDictionaryFeatureProvider(dictionary:inputs)
        let a=try reference.prediction(from:provider),b=try actual.prediction(from:provider)
        guard a.featureNames==b.featureNames else {throw NSError(domain:"OutputNames",code:1)}
        for name in a.featureNames {
            guard let x=a.featureValue(for:name)?.multiArrayValue,let y=b.featureValue(for:name)?.multiArrayValue,x.shape==y.shape else {throw NSError(domain:"OutputShape",code:1)}
            for i in 0..<x.count {let v=x[i].doubleValue,w=y[i].doubleValue;if v==w || (v.isNaN&&w.isNaN){continue};if !v.isFinite || !w.isFinite || abs(v-w)>1e-5*max(1,abs(v)){throw NSError(domain:"NumericalMismatch",code:i)}}
        }
        passed+=1
    }catch{failures+=1;print("FAIL: \(error)")}
}
print("Runtime fixtures passed: \(passed); failed: \(failures)")
if failures>0 {exit(1)}
