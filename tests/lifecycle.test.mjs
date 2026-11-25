import {test} from "node:test";
import assert from "node:assert/strict";
import {Bridge} from "../extension/bridge.mjs";
test("exit rejects pending and future operations", {timeout:5000}, async()=>{
 const b=new Bridge(process.execPath,"unused","unused");
 const pending=b.call("providers");
 await assert.rejects(pending);
 await assert.rejects(b.call("providers"));
 await assert.rejects(b.fetch("fixture")("https://fixture.invalid"));
 await b.close();
});
test("launch failure can close", {timeout:5000}, async()=>{
 const b=new Bridge("/nonexistent/magpie-pi","unused","unused");
 await assert.rejects(b.call("providers"));
 await b.close();
 await b.close();
});
