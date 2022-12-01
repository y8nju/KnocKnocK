const express = require('express');
const router = express.Router();
const Account = require('../Models/accounts');

router.route('/login')
	.get((req, res) => {
		res.render('accounts/login', {msg: ''})
	})
	.post(async (req, res) => {
		console.log(req.body)
		let getId = await Account.findOne({id: req.body.id});
		if(getId) {
			if(getId.password === req.body.password) {
				req.session.auth = true
				req.session.userId = req.body.id
				res.redirect('/chats');
			} else {
				res.render('accounts/login', {msg: '⩗ 계정과 비밀번호를 확인하세요'});
			}
		}
	})
	

router.get("/idCheck", async(req, res) => {
	let getId = await Account.findOne({id: req.query.id});
	console.log(req.query.id)
	console.log(getId)
	const obj = {};
	if(!getId) {
		obj.success = true;
	}else {
		obj.success = false;
	}
	res.json(obj);
})

router.route('/signup')
	.get((req, res) => {
		res.render('accounts/signup', {msg: ""})
	})
	.post(async (req, res) => {
		let getId = await Account.findOne({id: req.query.id});
		if(!getId){
			let result = await Account.create({
				id: req.body.id,
				password: req.body.password,
				email: req.body.email
			});
			console.log(result);
			req.session.auth = true
			req.session.userId = req.body.id
			res.redirect('/chats');
		}
		//등록된 아이디가 있는 경우, 회원가입 버튼 disabled 처리해놓기
		//등록된 아이디가 있는 경우, 회원가입 버튼 disabled 처리해놓기
	})

module.exports = router;