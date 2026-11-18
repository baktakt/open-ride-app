import { FitnessEquipmentSensor } from 'ant-plus-next';

// ant-plus-next 0.4 treats EVENT_RX_FAIL (a missed receive broadcast) as a
// failed acknowledged transfer and shifts its transmit queue. Only TX events
// may consume that queue; otherwise a later ACK gets attributed to the wrong
// command. Keep this compatibility shim covered with real library/event tests.
export class ReliableFitnessEquipmentSensor extends FitnessEquipmentSensor {
  async attach(channel, deviceId) {
    await super.attach(channel, deviceId);
    const onStatus = this.statusCbk;
    this.statusCbk = status => {
      if (status.msg === 0x01 && status.code === 0x02) return Promise.resolve(true);
      return onStatus(status);
    };
  }
}
