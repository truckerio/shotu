import test from 'node:test';
import assert from 'node:assert/strict';
import {repairScreenFromLocation,repairDocumentFromLocation,repairScreenUrl} from './repair-navigation.js';
test('repair navigation supports direct screens and rejects unknown destinations',()=>{
 for(const screen of ['chat','document','repair'])assert.equal(repairScreenFromLocation({search:`?repairView=${screen}`}),screen);
 assert.equal(repairScreenFromLocation({search:'?repairView=unknown'}),'repair');assert.equal(repairScreenFromLocation({}),'repair');
});
test('screen URLs preserve the capability fragment and unrelated query values',()=>{
 const url='https://shop.example/?source=email#customerRepair=secret';
 assert.equal(repairScreenUrl(url,'chat'),'/?source=email&repairView=chat#customerRepair=secret');
 assert.equal(repairScreenUrl('https://shop.example/?repairView=chat&source=email#customerRepair=secret','repair'),'/?source=email#customerRepair=secret');
 assert.equal(repairScreenUrl(url,'unsafe'),'/?source=email#customerRepair=secret');
});

test('a refreshed document screen retains invoice selection without leaking it into other screens',()=>{
 const link=repairScreenUrl('https://shop.example/#customerRepair=secret','document','invoice');
 assert.equal(link,'/?repairView=document&repairDocument=invoice#customerRepair=secret');
 assert.equal(repairDocumentFromLocation({search:new URL(link,'https://shop.example').search}),'invoice');
 assert.equal(repairDocumentFromLocation({search:'?repairDocument=unknown'}),'estimate');
 assert.equal(repairScreenUrl(new URL(link,'https://shop.example').href,'chat'),'/?repairView=chat#customerRepair=secret');
});
