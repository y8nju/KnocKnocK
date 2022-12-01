const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs')
const path = require('path')

const Room = require('../Models/Room');
const Message = require('../Models/Message');

const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, callback) => {
			console.log(req.query.roomId , req.body.roomId);
			const uploadPath = path.join(__dirname, "..", "static", "files", req.query.roomId);
			if (!fs.existsSync(uploadPath)) {
				fs.mkdirSync(uploadPath, { recursive: true });
			}
			req.uploadbaseURL = "/files/" + req.query.roomId+"/";
			callback(null, uploadPath);
		}
	})
});

router.use((req, res, next) => {
	if(req.session.auth) {
		res.locals.userSession = req.session.userId;
		res.locals.today = new Date();
		next();
	}else {
		res.redirect('/')
	}
});

const waitWss = new Map();
router.ws("/sse", (ws, req) => {
	//클라이언트 쪽에서 웹소켓 연결이 일어났을 때 작동
	// 사용자의 소켓 정보 저장
	waitWss.set(req.session.userId, ws);
	ws.on("close", () => {
		// 사용자의 소켓 정보 삭제
		waitWss.delete(req.session.userId);
	});
});

const roomWss = new Map();
router.ws('/room', (ws, req) => {
	console.log('ws://~room' + req.query._id)
	roomWss.set(req.session.userId, ws);
	ws.on('close', () => {
		roomWss.delete(ws);
	})
});

router.get('/', async (req, res)=> {
	const rooms = await Room.find({}).sort('-createdAt').populate('key').lean();
	rooms.forEach((room) => {
		room.key.sort((a, b) => -(a.createdAt - b.createdAt));
		let lastMsg = room.key.filter(key => {
			return key.readable.includes(req.session.userId)
		})
		room.lastMsg = lastMsg[0];
		let count = room.key.filter(key => {
			if(key.unread.includes(req.session.userId)) {
				return true;
			}
		});
		room.count = count.length;
		let joinerList;
		joinerList = room.joiner.map((elm) => elm.joinerName);
		room.joinerList = joinerList;
	});
	// const joinRooms = await Room.find({'joiner.joinerName': req.session.userId}).sort('-createdAt').populate({path: 'key', match : {unread : req.session.userId}}).lean();
	const joinRooms = await Room.find({'joiner.joinerName': req.session.userId}).sort('-createdAt').populate('key').lean();
	joinRooms.forEach((room) => {
		room.key.sort((a, b) => -(a.createdAt - b.createdAt));
		let lastMsg = room.key.filter(key => {
			if(!(key.data === 'serverMsg')) {
				return key.readable.includes(req.session.userId)
			}
		})
		room.lastMsg = lastMsg[0];
		let count = room.key.filter(key => {
			if(key.unread.includes(req.session.userId)) {
				return true;
			}
		});
		room.count = count.length;
	})
	const notRooms =  await Room.find({'joiner.joinerName': {$ne:  req.session.userId}}).sort('-createdAt').lean();

	// console.dir(joinRooms, {depth: 3});
	res.locals.rooms = rooms;
	res.locals.joinRooms = joinRooms;
	res.locals.notRooms = notRooms;
	res.render('chats/index')
})

router.post('/open', async (req, res) => {
		let data = {...req.body, owner: req.session.userId}
		let result = await Room.create(data);
		console.log(result);
		waitWss.forEach((ws) => {
			ws.send(JSON.stringify({ "type": "new", session: req.session.userId }));
		});
		res.redirect('/chats/room?_id='+result._id)
	});
// router.get('/pwChk', async (req, res) => {
// 	let result = await Room.findById(req.body._id);
// 	res.redirect('/chats/room?_id='+result._id)
// 	console.log(result)
// })
router.get("/api/pwChk", async (req, res)=>{
	let room = await Room.findOne({_id: req.query._id, password: req.query.password});
	const obj = {};
	if(room) {
		obj.success = true;
	}else {
		obj.success = false;
	}
	res.json(obj);
});
router.get('/room', async (req, res) => {
	try {
		let joinerChk = await Room.findOne({_id: req.query._id, 'joiner.joinerName': req.session.userId});
		let joinerTime;
		let joinerList;
		if(!joinerChk) {
			const room = await Room.findByIdAndUpdate(req.query._id, 
				{$addToSet: {joiner: {joinerName: req.session.userId}}},
				{returnDocument: 'after'}).lean();
			res.locals.room = room;
			joinerList = room.joiner.map((elm) => elm.joinerName);
			let serverReadable = joinerList.filter((elm) => {
				return elm !== req.session.userId
			});
			await Message.create({
				roomId: req.query._id,
				talker: req.session.userId,
				data: 'serverMsg', 
				content: req.session.userId+'님이 입장하였습니다',
				readable: serverReadable
			});
			roomWss.forEach((ws) => {
				ws.send(JSON.stringify({
					apply: req.query._id, 
					type: 'join', 
					id:  req.session.userId,
					joiner: room.joiner,
					joinerList
				}));
			})
		}else {
			const room = await Room.findById(req.query._id);
			res.locals.room = room;
			joinerTime = joinerChk.joiner.find(function(data){ return data.joinerName === req.session.userId}).joinTime;
			joinerList = room.joiner.forEach((elm) => elm.joinerName);
			res.locals.joinerList = joinerList;
			await Message.updateMany({roomId: req.query._id, readable: req.session.userId}, {$pull: {unread: req.session.userId}},{returnDocument: 'after'}).lean();
		}
		const messages = await Message.find({roomId: req.query._id, readable: req.session.userId}).where('createdAt').gte(joinerTime).sort('createdAt').lean();
		res.locals.messages = messages.map((one) => {
			return { ...one, type : one.talker == req.session.userId ? "mine" : "other" };
		});
		res.render('chats/room');
	} catch(e) {
		console.log(e);
		res.redirect('/chats');
	}
});

router.get('/exit', async(req, res) => {
	const room = await Room.findByIdAndUpdate(
		req.query._id, 
		{$pull:  {joiner: {joinerName: req.session.userId}}},
		{returnDocument: 'after'}).lean();
	await Message.updateMany(
		{roomId: req.query._id},
		{$pull: {readable: req.session.userId}})
	joinerList = room.joiner.map((elm) => elm.joinerName);
	let readable = joinerList.filter((elm) => {
		return elm !== req.session.userId
	});
	await Message.create({
		roomId: req.query._id,
		talker: req.session.userId,
		data: 'serverMsg', 
		content: req.session.userId+'님이 퇴장하였습니다',
		readable: readable
	});

	roomWss.forEach((ws) => {
		ws.send(JSON.stringify({
			apply: req.query._id, 
			type: 'exit', 
			id:  req.session.userId,
			joiner: room.joiner,
			joinerList: readable
		}));
		})
	res.redirect('/chats')
})

router.get('/delete', async (req, res) => {
	const room = await Room.findById(req.query._id);
	let joinerList = room.joiner.map((elm) => elm.joinerName);
	roomWss.forEach((ws) => {
		ws.send(JSON.stringify({ apply: req.query._id, type: 'delete', session: req.session.userId }));
	})
	waitWss.forEach((ws, joiner) => {
		if(joinerList.includes(joiner)) {
			ws.send(JSON.stringify({"type": "delete", roomTitle: room.title }));
		}
	});
	await Room.findByIdAndDelete(req.query._id);
	await Message.deleteMany({roomId: req.query._id});
	res.redirect('/chats')
})

// 채팅 룸에서 발생한 AJAX 요청을 처리할 곳
router.post('/api/message', async (req, res)=> {
	// req.body에 roomId랑 comment가 왔다는 조건 하에
	console.log(req.body);
	try {
		const room = await Room.findById(req.body.roomId).lean();
		let joinerList = room.joiner.map((elm) => elm.joinerName);
		console.log(joinerList)
		const unread = joinerList.filter((one) => {
			if (one !== req.session.userId) {
				return true;
			} else {
				return false;
			}
		});
		let result = await Message.create({
			...req.body,
			talker: req.session.userId, 
			data: 'chat', 
			readable: joinerList,
			unread,
		});
		result = result.toObject();
		roomWss.forEach((ws, ownerId) => {
			result.type = result.talker === ownerId ? "mine" : "other";
			ws.send(JSON.stringify({ apply: req.body.roomId, type: "new", data: result }));
		});
		waitWss.forEach((ws, ownerId) => {
			if(joinerList.includes(ownerId)) {
				ws.send(JSON.stringify({"type": "added", roomId: req.body.roomId }));
			}
		});
		res.json({ "success": true, "result": result });
	}catch(err) {
		res.json({ "success": false, "error": err.message });
	}
});

router.post('/api/upload', upload.single('attach'), async (req, res) => {
	// 업로드 처리는 됨
	// 이걸 데이터 베이스에 저장할 것
	// 이 요청을 했던 사용자에게  res.json으로 성공여부 알려주고
	// 해당 방 사용자들에게 파일이 업도드 된 것을 알 수 있도록
	// 메세지를 전송하는데, 랜더링에 필요한 데이터를 같이 보내줌
	try {
		const room = await Room.findById(req.body.roomId).lean();
		let joinerList = room.joiner.map((elm) => elm.joinerName);
		const unread = [...joinerList];
		unread.splice(unread.indexOf(req.session.userId), 1);
		let result = await Message.create({
			...req.body, 
			talker: req.session.userId, 
			data: 'file', 
			content: "/files/" + req.query.roomId+"/" + req.file.filename,
			readable : joinerList,
			unread
		});
		result = result.toObject();
		roomWss.forEach((ws, ownerId) => {
			result.type = result.talker === ownerId ? "mine" : "other";
			ws.send(JSON.stringify({ apply: req.body.roomId, type: "new", data: result }));
		});
		waitWss.forEach((ws, ownerId) => {
			if(joinerList.includes(ownerId)) {
				ws.send(JSON.stringify({type: "added", roomId: req.body.roomId }));
			}
		});
		res.json({ "success": true });
	}catch(err) {
		res.json({ "success": false });
	}
});
router.get("/api/checkcount", async (req, res)=>{
	try {
		let count = await Message.find({
			roomId: req.query.roomId, 
			unread: req.session.userId
		}).countDocuments();

		res.json({success: true, count});
	}catch(e) {
		console.log(e);
		res.json({success: false});
	}
});
router.get("/api/lastMsg", async (req, res)=>{
	try {
		let lastMsg = await Message.find({roomId: req.query.roomId}).sort('-createdAt').limit(1).lean();
		res.json({success: true, lastMsg});
	}catch(e) {
		console.log(e);
		res.json({success: false});
	}
});

module.exports = router;
