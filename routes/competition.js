const router = require("express").Router();
const { body, validationResult } = require('express-validator');
const schedule = require("node-schedule");
const { DBconnection } = require("../config/database");
const dateFormat = require("../config/date-formatting");

function GiveRewards(List, index, Award, comp_ID) {
    if (index >= List.length || index == 3) {
        return
    } else {
        const giveAward = "update dbproject.award set userID=" + List[index].ID + " where a_type='" + Award + "' and competitionID=" + comp_ID + " ;";
        DBconnection.query(giveAward, (err) => {
            if (err) { return console.log(err); }
            if (index == 0) { Award = 'Silver'; }
            if (index == 1) { Award = 'Bronze'; }
            GiveRewards(List, index + 1, Award, comp_ID);
        })
    }
}

router.get('/', (req, res) => {
    const errors = [];
    let deleteQueries=[];
    const deleteEmpty="select C_ID from dbproject.competition where C_ID not in (select C_ID from dbproject.questions where e_id is not null);"
    DBconnection.query(deleteEmpty,(err,toBeDeleted)=>{
        if (err) return console.error(err);
        for(var i=0;i<toBeDeleted.length;i++){
            let singleQuery="delete from dbproject.competition where C_ID="+toBeDeleted[i].C_ID+" ;";
            deleteQueries.push(singleQuery);
        }
        function deleteCompetition(deleteQueries,index){
            if(index>=deleteQueries.length){
                DBconnection.query('SELECT * FROM dbproject.competition'
                +' where C_ID not in (select t.C_ID from dbproject.t_contains_cs as t) '
                +' ORDER BY STARTDATE DESC, ENDDATE DESC;', (err, rows) => {
                    if (err) return console.error(err);
                    const competitions = rows;
                    if (competitions.length)
                        competitions.forEach(competition => {
                            competition.STARTDATE = dateFormat.format(competition.STARTDATE);
                            competition.ENDDATE = dateFormat.format(competition.ENDDATE);
                        });

                    res.render('competitions', {
                        title: "Competitions",
                        competitions,
                        errors
                    });
                });
            }else{
                DBconnection.query(deleteQueries[index],(err)=>{
                    if (err) return console.error(err);
                    console.log("query "+deleteQueries[index]+" is done");
                    deleteCompetition(deleteQueries,index+1);
                })
            }
        }
        deleteCompetition(deleteQueries,0);
        
    })
    
});

router.post("/search",(req,res)=>{
    let {searchedCompetition}=req.body;
    if(searchedCompetition==""){
        req.flash("error","Fill The Search Bar First");
        res.redirect('back');
    }
    searchedCompetition = searchedCompetition.toString().replace(/'/g, "");
    const query="select * from dbproject.competition where TITLE='"+searchedCompetition+"' ;";
    DBconnection.query(query,(err,Result)=>{
        if(err){return console.log(err);}
        if(Result.length!=0){
            res.redirect("/competitions/details/"+Result[0].C_ID+"");
        }else{
            req.flash("error","Competition Wasn't Found");
            res.redirect('back');
        }
    })
})

router.get('/details/:c_id', (req, res) => {
    const errors = [];
    if(req.isAuthenticated()){
        let alreadyParticpant=false;
        const CreatorQuery="select U_ID from dbproject.competition where C_ID="+req.params.c_id+" ;";
        const alreadyParticipated="select userID from dbproject.participate where competitionID="+req.params.c_id+" and userID="+req.user.ID+" ;";
        DBconnection.query(`SELECT * FROM dbproject.competition WHERE C_ID=${req.params.c_id}`, (err, rows) => {
            if (err) return console.error(err);
            if (!rows.length) return res.sendStatus(404);
            DBconnection.query(CreatorQuery,(err,Creator)=>{
                if (err) return console.error(err);
                DBconnection.query(alreadyParticipated,(err,Participant)=>{
                    if (err) return console.error(err);
                    const competition = rows[0];
                    if(competition.STARTDATE>Date.now() || competition.ENDDATE<Date.now() || Creator.length!=0 || Participant.length!=0){
                        alreadyParticpant=true;
                    }
                    competition.STARTDATE = dateFormat.format(competition.STARTDATE);
                    competition.ENDDATE = dateFormat.format(competition.ENDDATE);
                    DBconnection.query(`SELECT firstName, lastName FROM dbproject.user WHERE ID=${competition.U_ID}`, (err, [user]) => {
                        res.render("competition-details", {
                            title: competition.TITLE,
                            competition,
                            host: user,
                            errors,
                            alreadyParticpant
                        });
                    });
                })
            })
        });
    }else{
        req.flash("error", "Please log in first");
        res.redirect("/users/login");
    }
});

router.get('/leaderboard/:c_id/:comp_name/', (req, res) => {
    const errors = [];
    if (req.isAuthenticated()) {
        const query = "select u.ID,u.Username,l.grade,l.duration,l.score from dbproject.leaderboard as l,dbproject.user as u "
            + " where C_ID=" + req.params.c_id + " and " + "u.ID=l.U_ID order by score desc, grade desc, duration asc;";
        const comp_ID = req.params.c_id;
        const comp_TITLE = req.params.comp_name;

        DBconnection.query(query, (err, List) => {
            if (err) {
                return console.log(err);
            } else {
                console.log(List);
                GiveRewards(List, 0, 'Gold', comp_ID);
                res.render("leaderboard", {
                    title: comp_TITLE,
                    errors,
                    comp_ID,
                    comp_TITLE,
                    List
                });
            }
        })
    } else {
        req.flash("error", "Please log in first");
        res.redirect("/users/login");
    }
});

router.get('/questions/:c_id', (req, res) => {
    if (req.isAuthenticated()) {
        const errors = [];

        DBconnection.query(`SELECT * FROM dbproject.competition WHERE C_ID=${req.params.c_id}`, (err, competition) => {
            if (err) return console.error(err);
            if (!competition.length) return res.sendStatus(404);
            competition = competition[0];
            if (Date.now() < competition.STARTDATE) {
                req.flash("error", "This competition hasn't started yet.");
                res.redirect('back');
            } else if (Date.now() > competition.ENDDATE) {
                req.flash("error", "This competition has already finished");
                res.redirect('back');
            } else if (competition.U_ID === req.user.ID) {
                req.flash('error', 'You can\'t participate in this comeptition as you are the host of it.');
                res.redirect('back');
            } else {
                //Checking there is enough money
                costQuery = "select spirits from dbproject.user where ID=" + req.user.ID + " ;";
                DBconnection.query(costQuery, (err, money) => {
                    if (err) { return console.log(err); }
                    else {
                        console.log(money);
                        if (money[0].spirits >= competition.cost) {
                            const rest = money[0].spirits - competition.cost;
                            minusCostQuery = "update dbproject.user set spirits=" + rest + " where ID=" + req.user.ID + " ;";
                            DBconnection.query(`SELECT * FROM dbproject.QUESTIONS WHERE c_id=${req.params.c_id}`, (err, questions) => {
                                if (err) return console.error(err);
                                DBconnection.query(`SELECT s_time FROM dbproject.participate WHERE userID=${req.user.ID} AND competitionID=${competition.C_ID};`, (err, rows) => {
                                    if (err) return console.error(err);
                                    if (rows.length) {
                                        req.flash('error', 'You already participated in this competition.');
                                        return res.redirect(`/competitions/reviews/${competition.C_ID}`);
                                    }
                                    DBconnection.query(minusCostQuery, (err) => {
                                        if (err) { return console.log(err); }
                                        const query = `INSERT INTO dbproject.participate (userID, competitionID) VALUES (${req.user.ID}, ${competition.C_ID});`;
                                        DBconnection.query(query, (err, results, fields) => {
                                            if (err) return console.error(err);
                                            res.render("competition-questions", {
                                                title: competition.TITLE,
                                                competition,
                                                questions,
                                                errors
                                            });
                                        });
                                    })

                                });
                            });
                        } else {
                            req.flash('error', "you don't have enough spirits to participate in that competition");
                            res.redirect('back');
                        }
                    }
                });
            }
        });
    } else {
        req.flash("error", "Please log in first");
        res.redirect("/users/login");
    }
});

router.post('/questions/:c_id', (req, res) => {
    if (req.isAuthenticated()) {
        const errors = [];

        DBconnection.query(`SELECT * FROM dbproject.competition WHERE C_ID=${req.params.c_id}`, (err, competition) => {
            if (err) return console.error(err);
            if (!competition.length) return res.sendStatus(404);
            competition = competition[0];
            if (Date.now() < competition.STARTDATE) {
                req.flash("error", "This competition hasn't started yet.");
                res.redirect('back');
            } else if (Date.now() > competition.ENDDATE) {
                req.flash("error", "This competition has already finished");
                res.redirect('back');
            } else {
                DBconnection.query(`SELECT * FROM dbproject.QUESTIONS WHERE c_id=${req.params.c_id}`, (err, questions) => {
                    if (err) return console.error(err);
                    const userAnswers = req.body;
                    let grade = 0;
                    questions.forEach((question, index) => {
                        if (!userAnswers[`q${index + 1}`])
                            userAnswers[`q${index + 1}`] = "Null";
                        if (userAnswers[`q${index + 1}`] === question.CHOICE_1)
                            grade++;
                    });
                    DBconnection.query(`SELECT s_time FROM dbproject.participate WHERE userID=${req.user.ID} AND competitionID=${competition.C_ID};`, (err, [{ s_time }]) => {
                        if (err) return console.error(err);
                        const duration = Math.abs(Date.now() - s_time) / (1000 * 60);
                        let score = Math.round(((grade / duration) + Number.EPSILON) * 100) / 100;
                        score = 2 * questions.length * ((1 / (1 + Math.exp(-1 * score))) - 0.5);
                        const insertToLB = `INSERT INTO dbproject.leaderboard VALUES (${req.user.ID}, ${competition.C_ID}, ${grade}, ${duration}, ${score});`;
                        DBconnection.query(insertToLB, err => {
                            if (err) return console.error(err);
                            req.flash('success', 'Your answers are submitted!');
                            res.redirect(`/competitions/leaderboard/${competition.C_ID}/${competition.TITLE}`);
                        });
                    });
                });
            }
        });
    } else {
        req.flash("error", "Please log in first");
        res.redirect("/users/login");
    }
});

router.get('/reviews/:c_id', (req, res) => {
    if (req.isAuthenticated()) {
        const errors = [];

        DBconnection.query(`SELECT * FROM dbproject.competition WHERE C_ID=${req.params.c_id}`, (err, competition) => {
            if (err) return console.error(err);
            if (!competition.length) return res.sendStatus(404);
            competition = competition[0];
            DBconnection.query(`SELECT * FROM dbproject.review, dbproject.user WHERE U_ID=ID AND C_ID=${req.params.c_id} ORDER BY dateSubmit DESC`, (err, reviews) => {
                if (err) return console.error(err);
                const reactions = {
                    Like: ['thumbs-up', '#1649b8'],
                    Love: ['heart', '#E51552'],
                    Angry: ['angry', '#ffa500'],
                    Sad: ['frown', '#eeff00']
                }
                for (var i = 0; i < reviews.length; i++) {
                    reviews[i].dateSubmit = dateFormat.format(reviews[i].dateSubmit);
                }
                reviews.forEach(review => review.react = reactions[review.react]);
                res.render("competition-reviews", {
                    title: competition.TITLE,
                    competition,
                    reviews,
                    errors
                });
            });
        });
    } else {
        req.flash("error", "Please Login First");
        res.redirect("/users/login");
    }
});

router.post('/reviews/:c_id', [
    body('rate', 'Rate is required in a review').notEmpty(),
    body('reaction', 'Reaction is required in a review').notEmpty(),
    body('description', 'Description is required in a review').notEmpty()
], (req, res) => {
    if (req.isAuthenticated()) {
        let errors = validationResult(req).errors;
        const { rate, reaction, description } = req.body;
        if (errors.length) {
            errors.forEach(err => req.flash('error', err.msg));
            return res.redirect('back');
        }
        const validateQuery = "select * from dbproject.participate where userID=" + req.user.ID + " and competitionID=" + req.params.c_id + " ;";
        const query = "insert into dbproject.review (U_ID,C_ID,comment,rating,react) "
            + "values(" + req.user.ID + "," + req.params.c_id + ",'" + description + "'," + rate + ",'" + reaction + "');";
        DBconnection.query(validateQuery, (err, result) => {
            if (result.length > 0) {
                DBconnection.query(query, (err, results) => {
                    if (err) { return console.log(err); }
                    req.flash("success", "Your Review Is Submited Successfully");
                    res.redirect("/competitions/reviews/" + req.params.c_id + "");
                })
            } else {
                req.flash("error", "You Aren't A Participant To Leave A Review");
                res.redirect("/competitions/reviews/" + req.params.c_id + "");
            }
        })
    } else {
        req.flash("error", "Please Login First");
        res.redirect("/users/login");
    }
});

router.get('/CreateCompetition', (req, res) => {
    if (req.isAuthenticated()) {
        const errors = [];
        res.render("create-competition", {
            title: "Competition Creation",
            errors
        });
    } else {
        req.flash("error", "Please Login First");
        res.redirect("/users/login");
    }
});

router.post('/:username/CreateCompetition', [
    body('competitionTitle', 'Competition Title must be between 2 and 50 characters long').isLength({
        min: 2,
        max: 50
    }),
    body('description', 'Description must be between 0 and 500 characters long').isLength({
        min: 0,
        max: 500
    }),
    body('competitionCost', 'Competition cost Number must be entered').notEmpty(),
    body('questionNumber', 'Question Number must be selected').notEmpty(),
    body('startDate', 'Start Date must be selected').notEmpty(),
    body('endDate', 'End Date must be selected').notEmpty(),
], (req, res) => {
    if (req.isAuthenticated()) {
        let redirectLink = "/competitions/CreateCompetition";
        let errors = validationResult(req).errors;
        let {
            competitionTitle,
            competitionCost,
            category,
            questionNumber,
            startDate,
            endDate,
            description
        } = req.body;


        if (competitionTitle == "" || category == "" || startDate == "" || endDate == "" || description == "") {
            errors.unshift({ msg: "Please Fill In All Fields" });
        }

        if(competitionCost<0 || competitionCost>5000){
            errors.unshift({ msg: "Competition Cost Must Be Between 0-5000" });
        }

        if (errors.length) {
            return res.render("create-competition", {
                title: "Competition Creation",
                errors,
                competitionTitle,
                competitionCost,
                category,
                questionNumber,
                startDate,
                endDate,
                description
            });
        }

        competitionTitle = competitionTitle.toString().replace(/'/g, "`");
        description = description.toString().replace(/'/g, "`");
        category = category.toString().replace(/'/g, "`");

        //Date Validation
        function Compare(startDate, endDate) {
            sDate = new Date(startDate.toString());
            eDate = new Date(endDate.toString());
            var Result = false;
            if (sDate.getTime() < eDate.getTime()) {
                if (sDate.getDate() <= eDate.getDate()) {
                    Result = true;
                }
            }
            var today = new Date();
            if (sDate.getDate() < today.getDate()) {
                Result = false;
            } else {
                if (sDate.getDate() == today.getDate()) {
                    if (sDate.getTime() < today.getTime()) {
                        Result = false;
                    }
                }
            }
            return Result;
        }
        if (!Compare(startDate, endDate)) {
            req.flash("error", "Make Sure That Start Date Is Earlier Than End Date & Not Older Than Current Date");
            return res.redirect(redirectLink);
        }

        const query = "INSERT INTO dbproject.competition (TITLE,CATEGORY,DESCP,STARTDATE,ENDDATE,Qnum,U_ID,cost) " +
            "VALUES('" + competitionTitle + "','" + category + "','" + description + "','" + startDate + "','" + endDate + "'," + questionNumber + "," + req.user.ID + "," + competitionCost + ");";
        DBconnection.query(query, (err, rows) => {
            if (err) {
                console.log(err);
                req.flash("error", "Something Went Wrong Creating The Competition , Please Try Again Later");
                return res.render("create-competition", {
                    title: "Competition Creation",
                    errors,
                    competitionTitle,
                    category,
                    questionNumber,
                    startDate,
                    endDate,
                    description
                });
            } else {
                schedule.scheduleJob(endDate, function () {
                    console.log(rows.insertId);

                    const query = "select u.ID,u.Username,l.grade,l.duration,l.score from dbproject.leaderboard as l,dbproject.user as u "
                        + "where l.C_ID=" + rows.insertId + " and " + "u.ID=l.U_ID order by score desc, grade desc, duration asc;";

                    DBconnection.query(query, (err, List) => {
                        if (err) {
                            return console.log(err);
                        } else {
                            console.log(List);
                            GiveRewards(List, 0, 'Gold', rows.insertId);
                            const totalSpirits = List.length * competitionCost;
                            let prizeQuery;
                            switch (List.length) {
                                case 1:
                                    prizeQuery = `UPDATE dbproject.user SET spirits=${totalSpirits} where ID=${List[0].ID};`;
                                    break;
                                case 2:
                                    prizeQuery = `UPDATE dbproject.user SET spirits=${totalSpirits} where ID=${List[0].ID};`;
                                    break;
                                case 3:
                                    prizeQuery = `UPDATE dbproject.user SET spirits=${totalSpirits} where ID=${List[0].ID};`;
                                    break;
                                case 4:
                                    prizeQuery = `UPDATE dbproject.user SET spirits=${totalSpirits} where ID=${List[0].ID};`;
                                    break;
                                case 5:
                                    prizeQuery = `UPDATE dbproject.user SET spirits=${totalSpirits} where ID=${List[0].ID};`;
                                    break;
                            }
                        }
                    });
                });
                res.render("Cquestions-entry", {
                    title: "Questions Entry",
                    errors,
                    questionNumber,
                    competitionTitle
                })
            }
        });
    } else {
        req.flash("error", "Please Login First");
        res.redirect("/users/login");
    }
});

router.get("/:username/CreateCompetition/:Qnum/:Ctitle", (req, res) => {
    if (req.isAuthenticated()) {
        let errors = [];
        const questionNumber = req.params.Qnum;
        const competitionTitle = req.params.Ctitle;
        res.render("Cquestions-entry", {
            title: "Questions Entry",
            errors,
            questionNumber,
            competitionTitle
        });
    } else {
        req.flash("error", "Please Login First");
        res.redirect("/users/login");
    }
});

router.post('/:username/CreateCompetition/:Qnum/:Ctitle', (req, res) => {
    if (req.isAuthenticated()) {
        let errors = [];

        const redirectLink = "/competitions/" + req.user.Username + "/CreateCompetition/" + req.params.Qnum + "/" + req.params.Ctitle;
        const obj = req.body;
        let items = [];
        for (const name in obj) {
            console.log(obj[name]);
            items.push(obj[name]);
        }

        //Checking for empty questions
        for (let i = 0; i < items.length; i++) {
            if (items[i] == "") {
                req.flash("error", "Please Fill In All Fields & Try Again");
                return res.redirect(redirectLink);
            }
            items[i] = items[i].toString().replace(/'/g, "`");      //to not make query error
        }
        const counter = 4;
        let j = 0;

        function InsertQ(num, Title) {
            if (num * 5 < items.length) {
                console.log(items[0]);
                console.log(num);
                console.log(Title);
                let queryInsert = "insert into dbproject.questions (c_id,QUESTION,CHOICE_1,CHOICE_2,CHOICE_3,CHOICE_4) " +
                    "values(" + Title + ",'" + items[num + counter * num] + "','" + items[num + 1 + counter * num] + "','" + items[num + 2 + counter * num] + "','" + items[num + 3 + counter * num] + "','" + items[num + 4 + counter * num] + "');";
                console.log(queryInsert);
                DBconnection.query(queryInsert, (err, rows) => {
                    if (err) {
                        console.log(err);
                    } else {
                        j++;
                        InsertQ(j, Title);
                    }
                });
            } else {
                return;
            }
        }

        //inserting questions
        let queryGetComptetion = "select C_ID from dbproject.competition where TITLE='" + req.params.Ctitle + "';";
        console.log(queryGetComptetion);
        DBconnection.query(queryGetComptetion, (err, rows) => {
            if (err) {
                console.log(err);
            } else {
                InsertQ(j, rows[0].C_ID);
                //rendering congrats page
                res.redirect("/competitions/CompetitionCreated/" + req.params.Ctitle);
            }
        });
    } else {
        req.flash("error", "Please Login First");
        res.redirect("/users/login");
    }
});

router.get("/CompetitionCreated/:Ctitle", (req, res) => {
    if (req.isAuthenticated()) {
        let errors = [];
        let queryGetComptetion = "select C_ID from dbproject.competition where TITLE='" + req.params.Ctitle + "';";

        DBconnection.query(queryGetComptetion, (err, rows) => {
            if (err) {
                console.log(err);
            } else {
                let code = rows[0].C_ID;
                const awardQuery = "insert into dbproject.award (competitionID,a_type) values(" + code + ",'Gold'),(" + code + ",'Silver'),(" + code + ",'Bronze');";
                DBconnection.query(awardQuery, (err) => {
                    if (err) { return console.log(err); }
                    res.render("Ccompetition-success", {
                        title: "Competition Created",
                        errors,
                        code
                    });
                })
            }
        });
    } else {
        req.flash("error", "Please Login First");
        res.redirect("/users/login");
    }
});

module.exports = router;