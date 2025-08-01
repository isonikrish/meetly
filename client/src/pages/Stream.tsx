import { useEffect, useRef, useState } from 'react';
import { Device, types as mediasoupTypes } from 'mediasoup-client';
import type {
  RtpCapabilities,
  RtpParameters,
} from 'mediasoup-client/types';
import { useSocket } from '../lib/SocketProvider';

function Stream() {
  const socket = useSocket();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [, setDevice] = useState<mediasoupTypes.Device | null>(null);

  useEffect(() => {
    const start = async () => {
      if (!socket) return;

      const dev = new Device();
      const rtpCapabilities: RtpCapabilities = await new Promise((res) =>
        socket.emit('get-rtp-capabilities', {}, res)
      );
      await dev.load({ routerRtpCapabilities: rtpCapabilities });
      setDevice(dev);

      // Send transport
      const { params: sendParams } = await new Promise<{
        params: mediasoupTypes.TransportOptions;
      }>((res) => socket.emit('create-send-transport', {}, res));

      const sendTransport = dev.createSendTransport(sendParams);

      sendTransport.on('connect', ({ dtlsParameters }, callback) => {
        socket.emit('connect-transport', { dtlsParameters, direction: 'send' }, callback);
      });

      sendTransport.on('produce', ({ kind, rtpParameters }, callback) => {
        socket.emit('produce', { kind, rtpParameters }, ({ id }: { id: string }) => {
          callback({ id });
        });
      });

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      for (const track of stream.getTracks()) {
        await sendTransport.produce({ track });
      }

      const consumeRemoteProducer = async (producerSocketId: string) => {
        const { params: recvParams } = await new Promise<{
          params: mediasoupTypes.TransportOptions;
        }>((res) => socket.emit('create-recv-transport', {}, res));

        const recvTransport = dev.createRecvTransport(recvParams);

        recvTransport.on('connect', ({ dtlsParameters }, callback) => {
          socket.emit('connect-transport', { dtlsParameters, direction: 'recv' }, callback);
        });

        const consumerOptions = await new Promise<{
          id: string;
          producerId: string;
          kind: mediasoupTypes.MediaKind;
          rtpParameters: RtpParameters;
          error?: string;
        }>((res) => socket.emit('consume', { producerSocketId }, res));

        if (consumerOptions.error) {
          console.warn('Error consuming', consumerOptions.error);
          return;
        }

        const consumer = await recvTransport.consume({
          id: consumerOptions.id,
          producerId: consumerOptions.producerId,
          kind: consumerOptions.kind,
          rtpParameters: consumerOptions.rtpParameters,
        });

        const track = consumer.track;
        if (track) {
          const remoteStream = new MediaStream([track]);
          const videoElem = document.createElement('video');
          videoElem.srcObject = remoteStream;
          videoElem.autoplay = true;
          videoElem.playsInline = true;
          videoElem.muted = false;
          videoElem.className = 'w-full rounded-lg shadow-lg border border-gray-700';
          const container = document.getElementById('remote-videos');
          container?.appendChild(videoElem);
          remoteVideosRef.current.set(producerSocketId, videoElem);
        }
      };

      const existingProducers: string[] = await new Promise((res) =>
        socket.emit('get-producers', {}, res)
      );

      for (const producerSocketId of existingProducers) {
        await consumeRemoteProducer(producerSocketId);
      }

      socket.on('new-producer', async ({ producerSocketId }: { producerSocketId: string }) => {
        await consumeRemoteProducer(producerSocketId);
      });
    };

    start();
  }, [socket]);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <h2 className="text-2xl font-semibold text-center mb-6">🔴 You are Streaming</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="rounded-xl overflow-hidden border border-gray-800 shadow-md bg-gray-900">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-64 object-cover rounded-md"
          />
          <div className="text-center text-sm text-gray-400 py-2">You</div>
        </div>
        <div
          id="remote-videos"
          className="col-span-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"
        ></div>
      </div>
    </div>
  );
}

export default Stream;
