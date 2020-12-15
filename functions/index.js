const functions = require('firebase-functions')
const admin = require('firebase-admin')
const { google } = require('googleapis')

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

admin.initializeApp()


const FOLDER_ID = functions.config().drive.folder.id
const API_CLIENT_EMAIL = functions.config().drive.api.clientemail
const API_PRIVATE_KEY = functions.config().drive.api.privatekey

const createAuthorizedClient = async () => {
  const client  = new google.auth.JWT(
    API_CLIENT_EMAIL,
    null,
    API_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/drive']
  )
  await client.authorize()
  return client
}

const createDriveClient = async () => {
  const client = await createAuthorizedClient()

  return await google.drive({
    version: 'v3',
    auth: client
  })
}

const inviteUserToDrive = async email => {
  const drive = await createDriveClient()
  result = await drive.permissions.create({
    resource: {
      'type': 'user',
      'role': 'reader',
      'emailAddress': email
    },
    fileId: FOLDER_ID,
    fields: 'id',
    'sendNotificationEmail': true,
  })

  if (result.status === 200) {
    return result.data.id
  }
  return false
}

const removeUserFromDrive = async uid => {
  const drive = await createDriveClient()
  const db = admin.firestore()
  const userRef = db.doc(`users/${uid}`)
  const userData = (await userRef.get()).data()
  const result = await drive.permissions.delete({
    fileId: userData.invitedTo,
    permissionId: userData.permissionId,
  })

  if (result.status !== 200) {
    throw new Error(JSON.stringify(result))
  }

  await userRef.delete()
  return true
}

exports.join = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
    try {
      res.set('Access-Control-Allow-Origin', 'https://tomakako.web.app')
      res.set('Access-Control-Allow-Methods', 'OPTIONS, POST')
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      if (req.method === 'OPTIONS') {
        res.status(200).send()
        return
      }

      if (req.method !== 'POST') {
        res.status(405).send()
        return
      }

      // https://qiita.com/kuninori/items/6826dbd0f37ff9918ab3
      const token = req.headers.authorization.split('Bearer ')[1]
      let decotedToken
      try {
        decotedToken = await admin.auth().verifyIdToken(token)
      } catch (e) {
        console.error(e)
        res.status(400).send()
        return
      }

      const uid = decotedToken.uid
      const user = await admin.auth().getUser(uid)

      // Google と 高専のアドレスを取得
      const office365Email = '' || (user && user.providerData.filter(prov => prov.providerId === 'microsoft.com')[0].email)
      const googleEmail = '' || (user && user.providerData.filter(prov => prov.providerId === 'google.com')[0].email)

      if (!office365Email.endsWith('@tomakomai.kosen-ac.jp') || googleEmail === '') {
        res.status(403).send()
        return
      }

      // 先生の場合は弾く
      if (!office365Email.match(/^[a-z]{2}[0-9]{3}/)) {
        res.status(403).send()
        return
      }

      // Todo: すでに招待済みではないか検索
      const permissionId = await inviteUserToDrive(googleEmail)
      if (!permissionId) {
        // users/{userId}/agreed を削除
        res.status(500).send()
        return
      }

      const db = admin.firestore()
      const userRef = db.doc(`users/${uid}`)

      await userRef.create({
        agreedTo: 'v1',
        approvedBy: office365Email,
        invitedTo: FOLDER_ID,
        sentTo: googleEmail,
        invitedAt: admin.firestore.Timestamp.now(),
        permissionId,
      })

      res.status(201).send()
      return
    } catch (e) {
      console.error(e)
      res.status(500).send()
    }
  })

exports.leave = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
  try {
    res.set('Access-Control-Allow-Origin', 'https://tomakako.web.app')
    res.set('Access-Control-Allow-Methods', 'OPTIONS, POST')
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      res.status(200).send()
      return
    }

    if (req.method !== 'POST') {
      res.status(405).send()
      return
    }

    // https://qiita.com/kuninori/items/6826dbd0f37ff9918ab3
    const token = req.headers.authorization.split('Bearer ')[1]
    let decotedToken
    try {
      decotedToken = await admin.auth().verifyIdToken(token)
    } catch (e) {
      console.error(e)
      res.status(400).send()
      return
    }

    const uid = decotedToken.uid
    await removeUserFromDrive(uid)
    res.status(200).send()
  } catch (e) {
    console.error(e)
    res.status(500).send()
  }
})
