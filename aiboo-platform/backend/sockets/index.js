import { listThreats } from '../services/threat.service.js';
import { listDetections, listCameras } from '../services/camera.service.js';
import logger from '../utils/logger.js';

const ROOM_ADMIN = 'room:admin';
const ROOM_ANALYST = 'room:analyst';
const ROOM_VIEWER = 'room:viewer';

const roleToRoom = {
  admin: ROOM_ADMIN,
  analyst: ROOM_ANALYST,
  viewer: ROOM_VIEWER,
};

export default function (io) {
  io.on('connection', (socket) => {
    const user = socket.user;
    logger.info(`Socket connected: ${socket.id} (user: ${user?.email}, role: ${user?.role})`);

    const room = roleToRoom[user?.role];
    if (room) {
      socket.join(room);
    }

    socket.on('init', async () => {
      try {
        const [threats, detections, cameras] = await Promise.all([
          listThreats(),
          listDetections({}, 30),
          listCameras(),
        ]);
        // list* services return { data, total, ... } — the client contract for
        // init:data is plain arrays (it checks `payload?.length`). Normalize so
        // the dashboard actually populates on connect.
        const arr = (v) => (Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : []);
        socket.emit('init:data', {
          threats: arr(threats),
          detections: arr(detections),
          cameras: arr(cameras),
        });
      } catch (e) {
        logger.error(`socket init error: ${e.message}`);
      }
    });

    socket.on('subscribe:role', (role) => {
      const targetRoom = roleToRoom[role];
      if (targetRoom && user?.role === 'admin') {
        socket.join(targetRoom);
      }
    });

    socket.on('unsubscribe:role', (role) => {
      const targetRoom = roleToRoom[role];
      if (targetRoom) {
        socket.leave(targetRoom);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id} (user: ${user?.email})`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error: ${err.message}`);
    });
  });
}
